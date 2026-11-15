import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import {
  fakeUsersService,
  fakeDocumentsService,
  fakeCacheService,
} from './helpers/fakes.js';

const API_KEY = 'test-key-0123456789abcdef';

function buildApp(apiKey) {
  return createApp({
    config: { version: '0.1.0', apiKey },
    services: {
      users: fakeUsersService(),
      documents: fakeDocumentsService(),
      cache: fakeCacheService(),
    },
  });
}

test('without API_KEY the data endpoints stay open (backwards compatible)', async () => {
  const res = await request(buildApp(null)).post('/cache/k').send({ value: 'v' });
  assert.equal(res.status, 200);
});

test('with API_KEY, data endpoints reject a missing or wrong key (401)', async () => {
  const app = buildApp(API_KEY);
  for (const [path, header] of [
    ['/users/1', undefined],
    ['/documents/aaaaaaaaaaaaaaaaaaaaaaaa', 'Bearer wrong-key'],
    ['/cache/k', `Basic ${API_KEY}`],
    ['/cache/k', `Bearer ${API_KEY}x`],
  ]) {
    const req = request(app).get(path);
    if (header) req.set('Authorization', header);
    const res = await req;
    assert.equal(res.status, 401, `${path} with ${header}`);
    assert.equal(res.body.error, 'unauthorized');
    assert.equal(res.headers['www-authenticate'], 'Bearer');
  }
});

test('with API_KEY, the correct bearer token is accepted', async () => {
  const app = buildApp(API_KEY);
  const auth = `Bearer ${API_KEY}`;
  let res = await request(app).post('/users').set('Authorization', auth)
    .send({ name: 'Ada', email: 'ada@example.com' });
  assert.equal(res.status, 201);
  res = await request(app).get(`/users/${res.body.id}`).set('Authorization', auth);
  assert.equal(res.status, 200);
});

test('with API_KEY, probes and service info stay unauthenticated', async () => {
  const app = buildApp(API_KEY);
  for (const path of ['/', '/health', '/ready', '/version']) {
    const res = await request(app).get(path);
    assert.equal(res.status, 200, path);
  }
});
