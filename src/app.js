import express from 'express';
import { requireApiKey } from './auth.js';
import { createUsersRouter } from './routes/users.js';
import { createDocumentsRouter } from './routes/documents.js';
import { createCacheRouter } from './routes/cache.js';

// Body-parser errors carry a 4xx `status`; map them to stable codes.
const BODY_ERROR_CODES = {
  'entity.parse.failed': ['invalid_json', 'request body is not valid JSON'],
  'entity.too.large': ['payload_too_large', 'request body is too large'],
  'charset.unsupported': ['unsupported_media_type', 'unsupported charset'],
  'encoding.unsupported': ['unsupported_media_type', 'unsupported content encoding'],
};

/**
 * Security headers for a JSON-only API: nothing here should ever be
 * rendered as HTML, framed, sniffed, or cached by intermediaries.
 */
function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  });
  next();
}

/**
 * Builds the Express application.
 *
 * `services` carries the data-layer clients (PostgreSQL / MongoDB /
 * Redis) injected by src/server.js. Tests inject in-memory fakes
 * instead, so the HTTP layer can be tested without any database.
 * The core endpoints below need no services at all.
 */
export function createApp({ config, services = {} } = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(express.json({ limit: '100kb' }));

  app.get('/', (req, res) => {
    res.json({
      name: 'hello-devops',
      message: 'Hello from hello-devops!',
      version: config.version,
      endpoints: [
        { method: 'GET', path: '/', description: 'Service information' },
        { method: 'GET', path: '/health', description: 'Liveness probe (process is up)' },
        { method: 'GET', path: '/ready', description: 'Readiness probe (all databases reachable)' },
        { method: 'GET', path: '/version', description: 'Application version' },
        { method: 'POST', path: '/users', description: 'Create a user (PostgreSQL)' },
        { method: 'GET', path: '/users/:id', description: 'Read a user (PostgreSQL)' },
        { method: 'POST', path: '/documents', description: 'Create a document (MongoDB)' },
        { method: 'GET', path: '/documents/:id', description: 'Read a document (MongoDB)' },
        { method: 'POST', path: '/cache/:key', description: 'Store a value (Redis)' },
        { method: 'GET', path: '/cache/:key', description: 'Read a value (Redis)' },
      ],
    });
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
  });

  app.get('/version', (req, res) => {
    res.json({ name: 'hello-devops', version: config.version, node: process.version });
  });

  // Readiness: pings every dependency in parallel and answers 200 only
  // when all of them respond. Liveness (/health) deliberately does NOT
  // check dependencies — a dead database must not restart the pod.
  // Each service bounds its own ping time, so this always answers.
  app.get('/ready', async (req, res) => {
    const entries = [
      ['postgresql', services.users],
      ['mongodb', services.documents],
      ['redis', services.cache],
    ];
    const results = await Promise.allSettled(
      entries.map(([, svc]) =>
        svc && typeof svc.ping === 'function'
          ? svc.ping()
          : Promise.reject(new Error('not configured'))
      )
    );
    const checks = {};
    let ready = true;
    results.forEach((result, index) => {
      const name = entries[index][0];
      checks[name] = result.status === 'fulfilled' ? 'up' : 'down';
      if (result.status !== 'fulfilled') ready = false;
    });
    res
      .status(ready ? 200 : 503)
      .json({ status: ready ? 'ready' : 'not_ready', checks });
  });

  // Data endpoints (PostgreSQL / MongoDB / Redis), behind the optional
  // API key. Probes and service information stay unauthenticated.
  const auth = requireApiKey(config.apiKey);
  app.use('/users', auth, createUsersRouter(services.users));
  app.use('/documents', auth, createDocumentsRouter(services.documents));
  app.use('/cache', auth, createCacheRouter(services.cache));

  // Unknown routes → JSON 404, matching the API's response style.
  app.use((req, res) => {
    res.status(404).json({ error: 'not_found', path: req.originalUrl });
  });

  // Central error handler: request-body problems are client errors
  // (4xx); anything else is a bug — logged with its stack, answered 500.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status ?? err.statusCode;
    if (Number.isInteger(status) && status >= 400 && status < 500) {
      const [error, message] = BODY_ERROR_CODES[err.type] ?? ['bad_request', 'bad request'];
      return res.status(status).json({ error, message });
    }
    console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
    return res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
