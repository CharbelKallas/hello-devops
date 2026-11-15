/**
 * Small HTTP-aware error types shared by the service and route layers.
 *
 * Anything thrown with a statusCode is rendered by withService()
 * (src/http.js) as the matching JSON error response. Errors WITHOUT a
 * statusCode are programming errors: they reach the central error
 * handler in src/app.js and become a 500 with a full stack trace in the
 * logs — they are never disguised as a dependency outage.
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

/**
 * A data store could not be reached or failed to answer in time.
 * Services wrap every driver error in this type, so only genuine
 * dependency failures are answered with 503.
 */
export class ServiceUnavailableError extends Error {
  constructor(service, cause) {
    super(`${service} unavailable: ${describeError(cause)}`, { cause });
    this.name = 'ServiceUnavailableError';
    this.statusCode = 503;
    this.code = 'service_unavailable';
    this.service = service;
  }
}

/**
 * A readable one-line description of a driver error. Connection
 * failures are often AggregateErrors with an EMPTY message (e.g. both
 * ::1 and 127.0.0.1 refused), so fall back to the code / inner errors.
 */
export function describeError(err) {
  if (!err) return 'unknown error';
  if (err.message) return err.code ? `${err.code} ${err.message}` : err.message;
  if (Array.isArray(err.errors) && err.errors.length > 0) {
    return err.errors.map(describeError).join('; ');
  }
  return err.code || err.name || String(err);
}

/**
 * Rejects with a ServiceUnavailableError if `promise` does not settle
 * within `ms`, so a hung connection can never hang an HTTP request.
 */
export function withDeadline(service, promise, ms) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new ServiceUnavailableError(service, new Error(`timed out after ${ms} ms`))),
      ms
    );
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Runs one data-store operation under a deadline. Whatever goes wrong —
 * driver error, timeout, lost connection — is reported as the store
 * being unavailable (ServiceUnavailableError), exactly once.
 */
export async function callService(service, operation, ms) {
  try {
    return await withDeadline(service, Promise.resolve().then(operation), ms);
  } catch (err) {
    throw err instanceof ServiceUnavailableError ? err : new ServiceUnavailableError(service, err);
  }
}
