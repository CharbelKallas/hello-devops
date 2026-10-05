import { createPostgresUsers } from './postgres.js';
import { createMongoDocuments } from './mongo.js';
import { createRedisCache } from './redis.js';

/**
 * Wires the three data-layer services from configuration.
 *
 * Creating a service opens no connections (Pool/MongoClient connect
 * lazily, Redis connects on first use), so the API starts even when a
 * database is down: /ready reports per-dependency state and the
 * affected routes answer 503.
 */
export function createServices(config) {
  const users = createPostgresUsers(config.postgres);
  const documents = createMongoDocuments(config.mongodb);
  const cache = createRedisCache(config.redis);

  return {
    users,
    documents,
    cache,
    async close() {
      // allSettled: one failing shutdown must not block the others
      await Promise.allSettled([users.close(), documents.close(), cache.close()]);
    },
  };
}
