import { ConflictError } from '../../src/errors.js';

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

/** A service whose dependency is unreachable — used for 503 / /ready tests. */
export function failingService() {
  return {
    async ping() {
      throw new Error('simulated outage');
    },
    async get() {
      throw new Error('simulated outage');
    },
    async set() {
      throw new Error('simulated outage');
    },
    async create() {
      throw new Error('simulated outage');
    },
    async close() {},
  };
}
