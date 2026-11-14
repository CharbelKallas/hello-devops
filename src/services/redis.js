import { createClient } from 'redis';
import { ServiceUnavailableError, describeError, withDeadline } from '../errors.js';

const SERVICE = 'redis';
const CONNECT_TIMEOUT_MS = 3000;
const COMMAND_TIMEOUT_MS = 3000;

/**
 * Every key this application writes is namespaced, so the public
 * /cache API can never read or overwrite keys owned by other
 * applications sharing the same Redis instance.
 */
export const KEY_PREFIX = 'hello-devops:cache:';

/**
 * Redis cache access (node-redis).
 *
 * One client is created per process and connected on first use. Its
 * reconnect strategy retries forever with capped backoff, so the
 * client recovers on its own after a Redis outage. The offline queue
 * is DISABLED: while Redis is unreachable, commands fail immediately
 * (→ 503) instead of queuing until Redis returns — previously such
 * requests, including /ready, hung indefinitely.
 */
export function createRedisCache({ host, port }) {
  const client = createClient({
    socket: {
      host,
      port,
      connectTimeout: CONNECT_TIMEOUT_MS,
      reconnectStrategy: (retries) => Math.min(100 * 2 ** retries, 5000),
    },
    disableOfflineQueue: true,
  });

  // Log one line per outage rather than one per reconnect attempt; an
  // 'error' listener is also mandatory (an unhandled 'error' event
  // would crash the process).
  let outageLogged = false;
  client.on('error', (err) => {
    if (outageLogged) return;
    outageLogged = true;
    console.warn(`[${SERVICE}] connection error (will keep retrying): ${describeError(err)}`);
  });
  client.on('ready', () => {
    if (outageLogged) console.warn(`[${SERVICE}] connection restored`);
    outageLogged = false;
  });

  let connecting = null;
  let closed = false;

  async function command(fn) {
    if (closed) throw new ServiceUnavailableError(SERVICE, new Error('client closed'));
    if (!connecting) {
      // connect() resolves once the first connection succeeds; with the
      // reconnect strategy above it keeps retrying in the background.
      connecting = client.connect().catch((err) => {
        if (!closed) console.warn(`[${SERVICE}] connect failed: ${describeError(err)}`);
      });
    }
    if (!client.isReady) {
      // Give a fresh connection a brief chance to come up; afterwards
      // fail fast instead of waiting for Redis.
      await withDeadline(SERVICE, connecting, CONNECT_TIMEOUT_MS).catch(() => {});
    }
    try {
      return await withDeadline(SERVICE, fn(), COMMAND_TIMEOUT_MS);
    } catch (err) {
      if (err instanceof ServiceUnavailableError) throw err;
      throw new ServiceUnavailableError(SERVICE, err);
    }
  }

  return {
    async get(key) {
      return command(() => client.get(KEY_PREFIX + key)); // string | null
    },

    async set(key, value, ttlSeconds) {
      return command(() =>
        ttlSeconds
          ? client.set(KEY_PREFIX + key, value, { EX: ttlSeconds })
          : client.set(KEY_PREFIX + key, value)
      );
    },

    async ping() {
      await command(() => client.ping());
      return true;
    },

    async close() {
      closed = true;
      if (!connecting) return;
      try {
        if (client.isReady) await client.close();
        else client.destroy();
      } catch {
        try {
          client.destroy();
        } catch {
          /* already closed */
        }
      }
    },
  };
}
