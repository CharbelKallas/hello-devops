/**
 * Wraps an async route handler so route bodies stay free of
 * try/catch boilerplate:
 *
 *  - 4xx errors (BadRequest / NotFound / Conflict) are rendered as the
 *    matching JSON error response with their message;
 *  - ServiceUnavailableError (503) is logged and answered with
 *    `{ error: 'service_unavailable', service }` — the internal cause is
 *    logged, never sent to the client;
 *  - anything else is a bug and is passed to the central error handler
 *    (500, full stack trace logged).
 */
export function withService(serviceName, handler) {
  return (req, res, next) => {
    Promise.resolve()
      .then(() => handler(req, res, next))
      .catch((err) => {
        if (!err) return next(new Error('route handler rejected without an error'));
        if (res.headersSent || !err.statusCode) return next(err);
        if (err.statusCode === 503) {
          console.error(`[${serviceName}] ${req.method} ${req.originalUrl}: ${err.message}`);
          return res
            .status(503)
            .json({ error: 'service_unavailable', service: serviceName });
        }
        return res
          .status(err.statusCode)
          .json({ error: err.code, message: err.message });
      });
  };
}
