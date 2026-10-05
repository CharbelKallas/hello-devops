import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('loadConfig falls back to local-development defaults', () => {
  const config = loadConfig({});
  assert.equal(config.port, 3000);
  assert.ok(config.version.length > 0);
});

test('loadConfig honours PORT and VERSION overrides', () => {
  const config = loadConfig({ PORT: '8080', VERSION: '9.9.9' });
  assert.equal(config.port, 8080);
  assert.equal(config.version, '9.9.9');
});

test('loadConfig treats an empty PORT as "not set"', () => {
  const config = loadConfig({ PORT: '' });
  assert.equal(config.port, 3000);
});

test('loadConfig rejects an invalid PORT', () => {
  assert.throws(() => loadConfig({ PORT: 'not-a-port' }), /PORT must be an integer/);
  assert.throws(() => loadConfig({ PORT: '99999' }), /PORT must be an integer/);
});

test('loadConfig provides database defaults for local development', () => {
  const config = loadConfig({});
  assert.equal(config.postgres.host, 'localhost');
  assert.equal(config.postgres.port, 5432);
  assert.equal(config.postgres.database, 'lab');
  assert.equal(config.postgres.user, 'postgres');
  assert.equal(config.postgres.password, '');
  assert.equal(config.mongodb.uri, 'mongodb://localhost:27017/hello-devops');
  assert.equal(config.redis.host, 'localhost');
  assert.equal(config.redis.port, 6379);
});

test('loadConfig honours database environment variables', () => {
  const config = loadConfig({
    PGHOST: 'db.internal',
    PGPORT: '15432',
    PGDATABASE: 'appdb',
    PGUSER: 'app',
    PGPASSWORD: 'from-env-only',
    MONGODB_URI: 'mongodb://mongo.internal:27017/app',
    REDIS_HOST: 'cache.internal',
    REDIS_PORT: '6380',
  });
  assert.equal(config.postgres.host, 'db.internal');
  assert.equal(config.postgres.port, 15432);
  assert.equal(config.postgres.database, 'appdb');
  assert.equal(config.postgres.user, 'app');
  assert.equal(config.postgres.password, 'from-env-only');
  assert.equal(config.mongodb.uri, 'mongodb://mongo.internal:27017/app');
  assert.equal(config.redis.host, 'cache.internal');
  assert.equal(config.redis.port, 6380);
});

test('loadConfig rejects an invalid PGPORT', () => {
  assert.throws(() => loadConfig({ PGPORT: 'nope' }), /PGPORT must be an integer/);
});
