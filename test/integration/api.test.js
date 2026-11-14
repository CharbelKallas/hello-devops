/**
 * Integration tests: the real app wired to REAL PostgreSQL, MongoDB and
 * Redis (no fakes). Start the databases first:
 *
 *   npm run db:up && npm run test:integration
 *
 * Connection settings come from the same environment variables as the
 * app (defaults match compose.yaml). CI runs these against service
 * containers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import request from 'supertest';
import pg from 'pg';
import { createClient } from 'redis';
import { loadConfig } from '../../src/config.js';
import { createApp } from '../../src/app.js';
import { createServices } from '../../src/services/index.js';
import { KEY_PREFIX } from '../../src/services/redis.js';
import { createMongoDocuments } from '../../src/services/mongo.js';
import { createPostgresUsers } from '../../src/services/postgres.js';

const config = loadConfig();
const services = createServices(config);
const app = createApp({ config, services });
const run = randomUUID().slice(0, 8); // keeps data from separate runs apart

test.after(() => services.close());

test('GET /ready reports every real dependency up', async () => {
  const res = await request(app).get('/ready');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.checks, { postgresql: 'up', mongodb: 'up', redis: 'up' });
});

test('users: create, read back, reject duplicates, 404 on unknown', async () => {
  const email = `ada-${run}@example.com`;
  const created = await request(app)
    .post('/users')
    .send({ name: ' Ada Lovelace ', email: email.toUpperCase() });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.name, 'Ada Lovelace');
  assert.equal(created.body.email, email);
  assert.ok(Number.isInteger(created.body.id));
  assert.ok(!Number.isNaN(Date.parse(created.body.createdAt)));

  const read = await request(app).get(`/users/${created.body.id}`);
  assert.equal(read.status, 200);
  assert.deepEqual(read.body, created.body);

  const dup = await request(app).post('/users').send({ name: 'Other', email });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error, 'conflict');

  assert.equal((await request(app).get('/users/2147483647')).status, 404);
  assert.equal((await request(app).get('/users/99999999999')).status, 404);
});

test('documents: create, read back, 404 on unknown id', async () => {
  const created = await request(app)
    .post('/documents')
    .send({ type: 'note', title: `Release ${run}`, body: 'first version' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.match(created.body.id, /^[0-9a-f]{24}$/);

  const read = await request(app).get(`/documents/${created.body.id}`);
  assert.equal(read.status, 200);
  assert.deepEqual(read.body, created.body);

  const missing = await request(app).get('/documents/000000000000000000000000');
  assert.equal(missing.status, 404);
});

test('cache: set, get, namespaced storage, TTL expiry', async () => {
  const key = `greeting-${run}`;
  const set = await request(app).post(`/cache/${key}`).send({ value: 'hello' });
  assert.equal(set.status, 200);
  const get = await request(app).get(`/cache/${key}`);
  assert.equal(get.status, 200);
  assert.equal(get.body.value, 'hello');

  // The raw Redis key is namespaced: the API cannot touch other apps' keys.
  const raw = createClient({ socket: { host: config.redis.host, port: config.redis.port } });
  await raw.connect();
  try {
    assert.equal(await raw.get(KEY_PREFIX + key), 'hello');
    assert.equal(await raw.get(key), null);
  } finally {
    await raw.close();
  }

  const ttlKey = `short-${run}`;
  const withTtl = await request(app).post(`/cache/${ttlKey}`).send({ value: 'x', ttl: 1 });
  assert.equal(withTtl.status, 200);
  assert.equal((await request(app).get(`/cache/${ttlKey}`)).status, 200);
  await new Promise((resolve) => setTimeout(resolve, 2100));
  assert.equal((await request(app).get(`/cache/${ttlKey}`)).status, 404);
});

test('regression: PostgreSQL killing idle connections does not crash the app', async () => {
  // A service whose connections carry a unique application_name, so
  // only ITS connections are terminated — never anyone else's, even if
  // PG* points at a shared database.
  const applicationName = `hello-devops-test-${run}`;
  const users = createPostgresUsers({ ...config.postgres, applicationName });
  const admin = new pg.Client(config.postgres);
  try {
    // Leave an idle client in the pool...
    assert.equal(await users.ping(), true);

    // ...then terminate it from the server side, as a PostgreSQL
    // restart or failover does. Before the fix, the pool's unhandled
    // 'error' event crashed the process here.
    await admin.connect();
    const { rowCount } = await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = $1',
      [applicationName]
    );
    assert.ok(rowCount >= 1, 'expected an idle connection to terminate');
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Still alive, and the pool reconnects transparently.
    assert.equal(await users.ping(), true);
  } finally {
    await admin.end();
    await users.close();
  }
});

test('regression: MongoDB unreachable at startup recovers once it is back', async () => {
  // Reserve a free local port, then leave it closed: MongoDB "is down".
  const port = await new Promise((resolve) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port: free } = probe.address();
      probe.close(() => resolve(free));
    });
  });
  const target = new URL(config.mongodb.uri);
  const documents = createMongoDocuments({
    uri: `mongodb://127.0.0.1:${port}/hello-devops?directConnection=true`,
  });
  let proxy;
  try {
    await assert.rejects(documents.ping(), { statusCode: 503 });

    // "MongoDB comes back": forward the port to the real server. Before
    // the fix the client stayed "Topology is closed" forever.
    proxy = net.createServer((socket) => {
      const upstream = net.connect(Number(target.port || 27017), target.hostname);
      socket.pipe(upstream).pipe(socket);
      socket.on('error', () => upstream.destroy());
      upstream.on('error', () => socket.destroy());
    });
    await new Promise((resolve) => proxy.listen(port, '127.0.0.1', resolve));

    assert.equal(await documents.ping(), true);
  } finally {
    await documents.close();
    proxy?.close();
  }
});

test('PostgreSQL data errors are bugs (500), not reported as an outage (503)', async () => {
  // Bypass route validation to hit the real database with bad data.
  await assert.rejects(services.users.create({ name: 'a\u0000b', email: `nul-${run}@example.com` }), (err) => {
    assert.equal(err.statusCode, undefined);
    assert.equal(err.code, '22021');
    return true;
  });
});

test('replicas creating the schema at the same time do not fail', async () => {
  // A throwaway database, so the shared one is never touched.
  const database = `hd_race_${run.replace(/-/g, '')}`;
  const admin = new pg.Client(config.postgres);
  await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`);
  const replicas = Array.from({ length: 8 }, () =>
    createPostgresUsers({ ...config.postgres, database })
  );
  try {
    const results = await Promise.allSettled(replicas.map((users) => users.get(1)));
    for (const result of results) {
      assert.equal(result.status, 'fulfilled', String(result.reason));
      assert.equal(result.value, null);
    }
  } finally {
    await Promise.all(replicas.map((users) => users.close()));
    await admin.query(`DROP DATABASE ${database}`);
    await admin.end();
  }
});

test('a users table that disappears is recreated instead of failing forever', async () => {
  const database = `hd_drop_${run.replace(/-/g, '')}`;
  const admin = new pg.Client(config.postgres);
  await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`);
  const users = createPostgresUsers({ ...config.postgres, database });
  const inDb = new pg.Client({ ...config.postgres, database });
  try {
    assert.equal(await users.get(1), null); // schema ensured and remembered
    await inDb.connect();
    await inDb.query('DROP TABLE users'); // e.g. failover to a restored database
    assert.equal(await users.get(1), null);
    const created = await users.create({ name: 'Back', email: `back-${run}@example.com` });
    assert.equal(created.name, 'Back');
  } finally {
    await inDb.end();
    await users.close();
    await admin.query(`DROP DATABASE ${database}`);
    await admin.end();
  }
});

test('missing database privileges are reported as unavailable (503), not as a bug', async () => {
  const database = `hd_priv_${run.replace(/-/g, '')}`;
  const role = `hd_noperm_${run.replace(/-/g, '')}`;
  const admin = new pg.Client(config.postgres);
  await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`);
  await admin.query(`CREATE ROLE ${role} LOGIN`);
  const owner = createPostgresUsers({ ...config.postgres, database });
  const limited = createPostgresUsers({ ...config.postgres, database, user: role, password: '' });
  try {
    assert.equal(await owner.get(1), null); // table exists, owned by the admin user
    await assert.rejects(limited.get(1), (err) => {
      assert.equal(err.statusCode, 503);
      assert.equal(err.cause.code, '42501');
      return true;
    });
  } finally {
    await owner.close();
    await limited.close();
    await admin.query(`DROP DATABASE ${database}`);
    await admin.query(`DROP ROLE ${role}`);
    await admin.end();
  }
});
