import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import {
  fakeUsersService,
  fakeDocumentsService,
  fakeCacheService,
} from './helpers/fakes.js';

function buildApp() {
  return createApp({
    config: { version: '0.1.0' },
    services: {
      users: fakeUsersService(),
      documents: fakeDocumentsService(),
      cache: fakeCacheService(),
    },
  });
}

test('POST /cache/:key stores a value (200) and GET /cache/:key reads it back', async () => {
  const app = buildApp();

  let res = await request(app)
    .post('/cache/greeting')
    .send({ value: 'hello' });
  assert.equal(res.status, 200);
  assert.equal(res.body.key, 'greeting');
  assert.equal(res.body.value, 'hello');
  assert.equal(res.body.ttl, null);

  res = await request(app).get('/cache/greeting');
  assert.equal(res.status, 200);
  assert.equal(res.body.value, 'hello');
  assert.equal(res.body.hit, true);
});

test('POST /cache/:key accepts a TTL in seconds', async () => {
  const app = buildApp();
  const res = await request(app)
    .post('/cache/session')
    .send({ value: 'abc', ttl: 60 });
  assert.equal(res.status, 200);
  assert.equal(res.body.ttl, 60);
});

test('POST /cache/:key validates its input (400)', async () => {
  const app = buildApp();

  let res = await request(app).post('/cache/key1').send({});
  assert.equal(res.status, 400);

  res = await request(app).post('/cache/key1').send({ value: '' });
  assert.equal(res.status, 400);

  for (const ttl of ['abc', 0, -5, 1.5]) {
    res = await request(app).post('/cache/key1').send({ value: 'v', ttl });
    assert.equal(res.status, 400, `ttl ${JSON.stringify(ttl)} should be rejected`);
  }
  assert.equal(res.body.error, 'bad_request');
});

test('GET /cache/:key returns 404 on a cache miss', async () => {
  const app = buildApp();
  const res = await request(app).get('/cache/never-set');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'not_found');
});

test('cache routes answer 503 when Redis is down', async () => {
  const app = createApp({
    config: { version: '0.1.0' },
    services: {
      users: fakeUsersService(),
      documents: fakeDocumentsService(),
      cache: { async ping() { return true; }, async get() { throw new Error('down'); } },
    },
  });
  const res = await request(app).get('/cache/any');
  assert.equal(res.status, 503);
  assert.equal(res.body.service, 'redis');
});
