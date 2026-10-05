import { Router } from 'express';
import { withService } from '../http.js';

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
      const { value, ttl } = req.body ?? {};
      if (typeof value !== 'string' || value === '') {
        return res.status(400).json({
          error: 'bad_request',
          message: 'value (a non-empty string) is required',
        });
      }
      let ttlSeconds = null;
      if (ttl !== undefined && ttl !== null) {
        ttlSeconds = Number(ttl);
        if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
          return res.status(400).json({
            error: 'bad_request',
            message: 'ttl must be a positive integer (seconds)',
          });
        }
      }
      await cache.set(key, value, ttlSeconds);
      return res.status(200).json({ key, value, ttl: ttlSeconds });
    })
  );

  return router;
}
