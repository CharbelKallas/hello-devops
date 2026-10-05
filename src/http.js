/**
 * Wraps an async route handler so route bodies stay free of
 * try/catch boilerplate:
 *
 *  - errors carrying a statusCode (BadRequest / NotFound / Conflict)
 *    are rendered as the matching JSON error response;
 *  - every other error is a dependency failure: it is logged and
 *    answered with 503 service_unavailable, naming the service.
 */
export function withService(serviceName, handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch((err) => {
      if (err && err.statusCode) {
        return res
          .status(err.statusCode)
          .json({ error: err.code, message: err.message });
      }
      console.error(
        `[${serviceName}] ${req.method} ${req.originalUrl}: ${err.message}`
      );
      return res
        .status(503)
        .json({ error: 'service_unavailable', service: serviceName });
    });
  };
}
