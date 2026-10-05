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

test('POST /users creates a user (201) with trimmed, lowercased data', async () => {
  const app = buildApp();
  const res = await request(app)
    .post('/users')
    .send({ name: ' Ada Lovelace ', email: 'ADA@Example.com' });

  assert.equal(res.status, 201);
  assert.equal(res.body.name, 'Ada Lovelace');
  assert.equal(res.body.email, 'ada@example.com');
  assert.ok(Number.isInteger(res.body.id));
  assert.ok(res.body.createdAt);
  assert.equal(res.body.password, undefined);
});

test('POST /users validates its input (400)', async () => {
  const app = buildApp();

  let res = await request(app).post('/users').send({ email: 'a@b.co' });
  assert.equal(res.status, 400);

  res = await request(app).post('/users').send({ name: 'NoMail' });
  assert.equal(res.status, 400);

  res = await request(app)
    .post('/users')
    .send({ name: 'X', email: 'not-an-email' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'bad_request');
});

test('POST /users rejects a duplicate email (409), case-insensitively', async () => {
  const app = buildApp();
  await request(app)
    .post('/users')
    .send({ name: 'First', email: 'dup@example.com' });

  const res = await request(app)
    .post('/users')
    .send({ name: 'Second', email: 'DUP@EXAMPLE.COM' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'conflict');
});

test('GET /users/:id returns an existing user (200)', async () => {
  const app = buildApp();
  const created = await request(app)
    .post('/users')
    .send({ name: 'Grace Hopper', email: 'grace@example.com' });

  const res = await request(app).get(`/users/${created.body.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'Grace Hopper');
  assert.equal(res.body.email, 'grace@example.com');
});

test('GET /users/:id returns 404 for an unknown id', async () => {
  const app = buildApp();
  const res = await request(app).get('/users/9999');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'not_found');
});

test('GET /users/:id rejects a non-numeric id (400)', async () => {
  const app = buildApp();
  const res = await request(app).get('/users/not-a-number');
  assert.equal(res.status, 400);
});

test('routes answer 503 when the dependency is down', async () => {
  const app = createApp({
    config: { version: '0.1.0' },
    services: {
      users: { async ping() { return true; } },
      documents: fakeDocumentsService(),
      cache: fakeCacheService(),
    },
  });
  const res = await request(app)
    .post('/users')
    .send({ name: 'X', email: 'x@example.com' });
  assert.equal(res.status, 503);
  assert.equal(res.body.error, 'service_unavailable');
  assert.equal(res.body.service, 'postgresql');
});
