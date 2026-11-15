import { createHash, timingSafeEqual } from 'node:crypto';

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Optional bearer-token authentication for the data endpoints.
 *
 * With no key configured this is a no-op, so existing clients keep
 * working. With a key, requests must send `Authorization: Bearer <key>`.
 * Both values are hashed before the constant-time comparison, so the
 * comparison takes the same time whatever the length of the token.
 */
export function requireApiKey(apiKey) {
  if (!apiKey) return (req, res, next) => next();
  const expected = digest(apiKey);

  return (req, res, next) => {
    const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') ?? '');
    if (match && timingSafeEqual(digest(match[1].trim()), expected)) return next();
    res.set('WWW-Authenticate', 'Bearer');
    return res.status(401).json({
      error: 'unauthorized',
      message: 'a valid API key is required (Authorization: Bearer <key>)',
    });
  };
}
