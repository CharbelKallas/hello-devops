import test from 'node:test';
import assert from 'node:assert/strict';
import { ServiceUnavailableError, describeError, withDeadline } from '../src/errors.js';

test('describeError explains AggregateErrors that have an empty message', () => {
  const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), { code: 'ECONNREFUSED' });
  const err = new AggregateError([refused], '');
  assert.match(describeError(err), /ECONNREFUSED/);
});

test('withDeadline passes through a value that arrives in time', async () => {
  assert.equal(await withDeadline('db', Promise.resolve(42), 100), 42);
});

test('withDeadline turns a hang into a ServiceUnavailableError', async () => {
  const never = new Promise(() => {});
  await assert.rejects(withDeadline('redis', never, 20), (err) => {
    assert.ok(err instanceof ServiceUnavailableError);
    assert.equal(err.statusCode, 503);
    assert.equal(err.service, 'redis');
    return true;
  });
});
