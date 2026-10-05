import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import {
  fakeUsersService,
  fakeDocumentsService,
  fakeCacheService,
} from './helpers/fakes.js';

const config = { version: '0.1.0' };
const healthyServices = () => ({
  users: fakeUsersService(),
  documents: fakeDocumentsService(),
  cache: fakeCacheService(),
});

test('GET / returns service information', async () => {
  const app = createApp({ config, services: healthyServices() });
  const res = await request(app).get('/');
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'hello-devops');
  assert.equal(res.body.version, '0.1.0');
  assert.ok(Array.isArray(res.body.endpoints));
  assert.ok(res.body.endpoints.length >= 3);
});

test('GET /health reports the process as ok', async () => {
  const app = createApp({ config, services: healthyServices() });
  const res = await request(app).get('/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(typeof res.body.uptimeSeconds, 'number');
});

test('GET /version returns version and Node runtime', async () => {
  const app = createApp({ config, services: healthyServices() });
  const res = await request(app).get('/version');
  assert.equal(res.status, 200);
  assert.equal(res.body.version, '0.1.0');
  assert.match(res.body.node, /^v\d+/);
});

test('GET /ready reports 200 when every dependency is up', async () => {
  const app = createApp({ config, services: healthyServices() });
  const res = await request(app).get('/ready');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    status: 'ready',
    checks: { postgresql: 'up', mongodb: 'up', redis: 'up' },
  });
});

test('GET /ready reports 503 and names the down dependency', async () => {
  const services = healthyServices();
  services.cache = {
    async ping() {
      throw new Error('simulated outage');
    },
  };
  const app = createApp({ config, services });
  const res = await request(app).get('/ready');
  assert.equal(res.status, 503);
  assert.equal(res.body.status, 'not_ready');
  assert.equal(res.body.checks.postgresql, 'up');
  assert.equal(res.body.checks.mongodb, 'up');
  assert.equal(res.body.checks.redis, 'down');
});

test('unknown routes return a JSON 404', async () => {
  const app = createApp({ config, services: healthyServices() });
  const res = await request(app).get('/definitely-not-a-route');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'not_found');
});

test('a malformed JSON body is rejected with 400', async () => {
  const app = createApp({ config, services: healthyServices() });
  const res = await request(app)
    .post('/')
    .set('Content-Type', 'application/json')
    .send('{ not json');
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid_json');
});
