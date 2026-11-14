import { Router } from 'express';
import { withService } from '../http.js';

const MAX_KEY_LENGTH = 256;
const MAX_TTL_SECONDS = 365 * 24 * 60 * 60; // one year

/**
 * Accepts a positive whole number of seconds, as a JSON number or a
 * string of digits. Anything else (true, [5], 1.5, 1e20, ...) is null.
 */
function parseTtl(ttl) {
  let value = null;
  if (typeof ttl === 'number') value = ttl;
  else if (typeof ttl === 'string' && /^[0-9]+$/.test(ttl)) value = Number(ttl);
  return Number.isInteger(value) && value > 0 && value <= MAX_TTL_SECONDS ? value : null;
}

function invalidKey(key) {
  return key.length === 0 || key.length > MAX_KEY_LENGTH;
}

/**
 * /cache — generic key/value access backed by Redis, used to
 * demonstrate caching of frequently requested values.
 */
export function createCacheRouter(cache) {
  const router = Router();

  router.get(
    '/:key',
    withService('redis', async (req, res) => {
      const { key } = req.params;
      if (invalidKey(key)) {
        return res.status(400).json({
          error: 'bad_request',
          message: `key must be 1-${MAX_KEY_LENGTH} characters`,
        });
      }
      const value = await cache.get(key);
      if (value === null) {
        return res
          .status(404)
          .json({ error: 'not_found', message: `key "${key}" not found` });
      }
      return res.status(200).json({ key, value, hit: true });
    })
  );

  router.post(
    '/:key',
    withService('redis', async (req, res) => {
      const { key } = req.params;
      if (invalidKey(key)) {
        return res.status(400).json({
          error: 'bad_request',
          message: `key must be 1-${MAX_KEY_LENGTH} characters`,
        });
      }
      const { value, ttl } = req.body ?? {};
      if (typeof value !== 'string' || value === '') {
        return res.status(400).json({
          error: 'bad_request',
          message: 'value (a non-empty string) is required',
        });
      }
      let ttlSeconds = null;
      if (ttl !== undefined && ttl !== null) {
        ttlSeconds = parseTtl(ttl);
        if (ttlSeconds === null) {
          return res.status(400).json({
            error: 'bad_request',
            message: `ttl must be a whole number of seconds between 1 and ${MAX_TTL_SECONDS}`,
          });
        }
      }
      await cache.set(key, value, ttlSeconds);
      return res.status(200).json({ key, value, ttl: ttlSeconds });
    })
  );

  return router;
}
