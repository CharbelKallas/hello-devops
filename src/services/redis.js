import { createClient } from 'redis';

/**
 * Redis cache access (node-redis v4).
 *
 * node-redis requires an explicit connect(), so the first connection
 * is made lazily and shared; if it fails (Redis down), the client is
 * discarded so the next request retries from scratch. Connection
 * errors are also logged via the 'error' listener — without one, an
 * unhandled 'error' event would crash the process.
 */
export function createRedisCache({ host, port }) {
  let client = null;
  let connecting = null;

  function build() {
    const c = createClient({ socket: { host, port } });
    c.on('error', (err) => console.warn(`[redis] ${err.message}`));
    return c;
  }

  async function ensureConnected() {
    if (client && client.isReady) return;
    if (!connecting) {
      if (!client) client = build();
      const attempt = client;
      connecting = attempt
        .connect()
        .then(() => {
          connecting = null;
        })
        .catch((err) => {
          connecting = null;
          try {
            attempt.destroy();
          } catch {
            /* ignore */
          }
          client = null;
          throw err;
        });
    }
    return connecting;
  }

  return {
    async get(key) {
      await ensureConnected();
      return client.get(key); // string | null
    },

    async set(key, value, ttlSeconds) {
      await ensureConnected();
      if (ttlSeconds) return client.set(key, value, { EX: ttlSeconds });
      return client.set(key, value);
    },

    async ping() {
      await ensureConnected();
      return client.ping();
    },

    async close() {
      if (!client) return;
      try {
        await client.quit();
      } catch {
        try {
          client.destroy();
        } catch {
          /* ignore */
        }
      }
      client = null;
    },
  };
}
