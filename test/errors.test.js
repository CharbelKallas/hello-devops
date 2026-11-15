import test from 'node:test';
import assert from 'node:assert/strict';
import { ServiceUnavailableError, callService, describeError, withDeadline } from '../src/errors.js';

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

test('callService passes a successful result through', async () => {
  assert.equal(await callService('db', async () => 'ok', 100), 'ok');
});

test('callService wraps a driver error exactly once, keeping the cause', async () => {
  const driverError = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
  await assert.rejects(
    callService('mongodb', async () => { throw driverError; }, 100),
    (err) => {
      assert.ok(err instanceof ServiceUnavailableError);
      assert.equal(err.service, 'mongodb');
      assert.equal(err.cause, driverError);
      return true;
    }
  );
});

test('callService does not double-wrap a ServiceUnavailableError', async () => {
  const original = new ServiceUnavailableError('redis', new Error('offline'));
  await assert.rejects(
    callService('redis', async () => { throw original; }, 100),
    (err) => err === original
  );
});

test('callService wraps a synchronous throw from the operation', async () => {
  await assert.rejects(
    callService('redis', () => { throw new Error('sync failure'); }, 100),
    (err) => err instanceof ServiceUnavailableError && err.cause.message === 'sync failure'
  );
});

test('callService turns a hang into a 503 after the deadline', async () => {
  await assert.rejects(
    callService('redis', () => new Promise(() => {}), 20),
    (err) => err instanceof ServiceUnavailableError && /timed out/.test(err.message)
  );
});
