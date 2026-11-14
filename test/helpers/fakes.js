import { ConflictError, ServiceUnavailableError } from '../../src/errors.js';

/**
 * In-memory fakes implementing the exact service interfaces used by
 * the routes, so the HTTP layer is fully testable without any
 * database running.
 */

function randomObjectId() {
  let id = '';
  for (let i = 0; i < 24; i += 1) {
    id += Math.floor(Math.random() * 16).toString(16);
  }
  return id;
}

export function fakeUsersService() {
  const rows = new Map();
  let nextId = 1;
  return {
    async create({ name, email }) {
      for (const user of rows.values()) {
        if (user.email === email) {
          throw new ConflictError('a user with this email already exists');
        }
      }
      const user = {
        id: nextId++,
        name,
        email,
        createdAt: new Date().toISOString(),
      };
      rows.set(user.id, user);
      return user;
    },
    async get(id) {
      return rows.get(id) ?? null;
    },
    async ping() {
      return true;
    },
    async close() {},
  };
}

export function fakeDocumentsService() {
  const docs = new Map();
  return {
    async create({ type, title, body }) {
      const doc = {
        id: randomObjectId(),
        type,
        title,
        body,
        createdAt: new Date().toISOString(),
      };
      docs.set(doc.id, doc);
      return doc;
    },
    async get(id) {
      return docs.get(id) ?? null;
    },
    async ping() {
      return true;
    },
    async close() {},
  };
}

export function fakeCacheService() {
  const store = new Map();
  return {
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async set(key, value) {
      store.set(key, value);
      return 'OK';
    },
    async ping() {
      return true;
    },
    async close() {},
  };
}

/**
 * A service whose data store is unreachable: every operation fails the
 * way the real services do during an outage (ServiceUnavailableError).
 */
export function failingService(name = 'test-db') {
  const outage = async () => {
    throw new ServiceUnavailableError(name, new Error('simulated outage'));
  };
  return { ping: outage, get: outage, set: outage, create: outage, async close() {} };
}

/** A service with a programming error: methods throw a TypeError. */
export function buggyService() {
  const bug = async () => {
    throw new TypeError('simulated bug');
  };
  return { async ping() { return true; }, get: bug, set: bug, create: bug, async close() {} };
}
