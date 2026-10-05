/**
 * Small HTTP-aware error types shared by the service and route layers.
 * Anything thrown with a statusCode is rendered by withService()
 * (src/http.js) as the matching JSON error response; everything else
 * is treated as a dependency failure (503).
 */

export class BadRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BadRequestError';
    this.statusCode = 400;
    this.code = 'bad_request';
  }
}

export class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
    this.statusCode = 404;
    this.code = 'not_found';
  }
}

export class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConflictError';
    this.statusCode = 409;
    this.code = 'conflict';
  }
}
