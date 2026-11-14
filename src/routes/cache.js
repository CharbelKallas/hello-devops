import { Router } from 'express';
import { withService } from '../http.js';
import { BadRequestError, NotFoundError } from '../errors.js';

const MAX_KEY_LENGTH = 256;
const MAX_TTL_SECONDS = 365 * 24 * 60 * 60; // one year

/** The validated :key path parameter. */
function keyFrom(req) {
  const { key } = req.params;
  if (key.length === 0 || key.length > MAX_KEY_LENGTH) {
    throw new BadRequestError(`key must be 1-${MAX_KEY_LENGTH} characters`);
  }
  return key;
}

/**
 * Accepts a positive whole number of seconds, as a JSON number or a
 * string of digits; absent (undefined / null) means "no expiry".
 * Anything else (true, [5], 1.5, 1e20, ...) is rejected.
 */
function ttlFrom(ttl) {
  if (ttl === undefined || ttl === null) return null;
  let value = null;
  if (typeof ttl === 'number') value = ttl;
  else if (typeof ttl === 'string' && /^[0-9]+$/.test(ttl)) value = Number(ttl);
  if (!Number.isInteger(value) || value <= 0 || value > MAX_TTL_SECONDS) {
    throw new BadRequestError(
      `ttl must be a whole number of seconds between 1 and ${MAX_TTL_SECONDS}`
    );
  }
  return value;
}

/**
 * /cache — generic key/value access backed by Redis, used to
 * demonstrate caching of frequently requested values. Validation
 * errors are thrown and rendered by withService().
 */
export function createCacheRouter(cache) {
  const router = Router();

  router.get(
    '/:key',
    withService('redis', async (req, res) => {
      const key = keyFrom(req);
      const value = await cache.get(key);
      if (value === null) throw new NotFoundError(`key "${key}" not found`);
      return res.status(200).json({ key, value, hit: true });
    })
  );

  router.post(
    '/:key',
    withService('redis', async (req, res) => {
      const key = keyFrom(req);
      const { value, ttl } = req.body ?? {};
      if (typeof value !== 'string' || value === '') {
        throw new BadRequestError('value (a non-empty string) is required');
      }
      const ttlSeconds = ttlFrom(ttl);
      await cache.set(key, value, ttlSeconds);
      return res.status(200).json({ key, value, ttl: ttlSeconds });
    })
  );

  return router;
}
