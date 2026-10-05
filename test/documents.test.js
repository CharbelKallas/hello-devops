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

test('POST /documents creates a document (201) with a default type', async () => {
  const app = buildApp();
  const res = await request(app)
    .post('/documents')
    .send({ title: ' Release notes ', body: 'first version' });

  assert.equal(res.status, 201);
  assert.equal(res.body.title, 'Release notes');
  assert.equal(res.body.type, 'note');
  assert.equal(res.body.body, 'first version');
  assert.match(res.body.id, /^[0-9a-f]{24}$/i);
  assert.ok(res.body.createdAt);
});

test('POST /documents keeps an explicit type', async () => {
  const app = buildApp();
  const res = await request(app)
    .post('/documents')
    .send({ type: 'profile', title: 'Ada' });

  assert.equal(res.status, 201);
  assert.equal(res.body.type, 'profile');
});

test('POST /documents requires a title (400)', async () => {
  const app = buildApp();
  let res = await request(app).post('/documents').send({ body: 'no title' });
  assert.equal(res.status, 400);

  res = await request(app).post('/documents').send({ title: 42 });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'bad_request');
});

test('POST /documents rejects wrong field types (400)', async () => {
  const app = buildApp();
  const res = await request(app)
    .post('/documents')
    .send({ title: 'ok', type: 123 });
  assert.equal(res.status, 400);
});

test('GET /documents/:id returns an existing document (200)', async () => {
  const app = buildApp();
  const created = await request(app)
    .post('/documents')
    .send({ type: 'activity', title: 'logged in' });

  const res = await request(app).get(`/documents/${created.body.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.type, 'activity');
  assert.equal(res.body.title, 'logged in');
});

test('GET /documents/:id rejects a malformed ObjectId (400)', async () => {
  const app = buildApp();
  const res = await request(app).get('/documents/not-an-objectid');
  assert.equal(res.status, 400);
});

test('GET /documents/:id returns 404 for an unknown but well-formed id', async () => {
  const app = buildApp();
  const res = await request(app).get('/documents/aaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'not_found');
});
