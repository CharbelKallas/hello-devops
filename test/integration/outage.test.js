/**
 * Integration tests for dependency outages, using the real drivers
 * pointed at a port where nothing listens. Needs no database at all.
 *
 * Before the fix, the Redis cases hung forever (the client queued
 * commands until Redis came back) — including the /ready probe.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { loadConfig } from '../../src/config.js';
import { createApp } from '../../src/app.js';
import { createServices } from '../../src/services/index.js';

const DEAD_PORT = '9'; // "discard" port: nothing listens on it locally

const config = loadConfig({
  PGHOST: '127.0.0.1',
  PGPORT: DEAD_PORT,
  MONGODB_URI: `mongodb://127.0.0.1:${DEAD_PORT}/hello-devops`,
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: DEAD_PORT,
});
const services = createServices(config);
const app = createApp({ config, services });

test.after(() => services.close());

async function timed(req) {
  const start = Date.now();
  const res = await req;
  return { res, ms: Date.now() - start };
}

test('every data route answers 503 quickly when its database is down', async () => {
  const cases = [
    ['postgresql', request(app).post('/users').send({ name: 'X', email: 'x@example.com' })],
    ['postgresql', request(app).get('/users/1')],
    ['mongodb', request(app).post('/documents').send({ title: 't' })],
    ['mongodb', request(app).get('/documents/000000000000000000000000')],
    ['redis', request(app).post('/cache/k').send({ value: 'v' })],
    ['redis', request(app).get('/cache/k')],
  ];
  for (const [service, req] of cases) {
    const { res, ms } = await timed(req);
    assert.equal(res.status, 503, `${service}: ${JSON.stringify(res.body)}`);
    assert.deepEqual(res.body, { error: 'service_unavailable', service });
    assert.ok(ms < 7000, `${service} took ${ms} ms`);
  }
});

test('GET /ready answers 503 (not hang) with every dependency down', async () => {
  const { res, ms } = await timed(request(app).get('/ready'));
  assert.equal(res.status, 503);
  assert.deepEqual(res.body.checks, { postgresql: 'down', mongodb: 'down', redis: 'down' });
  assert.ok(ms < 7000, `/ready took ${ms} ms`);
});
