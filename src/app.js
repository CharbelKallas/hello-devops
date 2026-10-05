import express from 'express';
import { createUsersRouter } from './routes/users.js';
import { createDocumentsRouter } from './routes/documents.js';
import { createCacheRouter } from './routes/cache.js';

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
  app.use(express.json());

  app.get('/', (req, res) => {
    res.json({
      name: 'hello-devops',
      message: 'Hello from hello-devops!',
      version: config.version,
      endpoints: [
        { method: 'GET', path: '/', description: 'Service information' },
        { method: 'GET', path: '/health', description: 'Liveness probe (process is up)' },
        { method: 'GET', path: '/version', description: 'Application version' },
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

  // Data endpoints (PostgreSQL / MongoDB / Redis).
  app.use('/users', createUsersRouter(services.users));
  app.use('/documents', createDocumentsRouter(services.documents));
  app.use('/cache', createCacheRouter(services.cache));

  // Unknown routes → JSON 404, matching the API's response style.
  app.use((req, res) => {
    res.status(404).json({ error: 'not_found', path: req.originalUrl });
  });

  // Central error handler: malformed JSON is a client error (400);
  // anything else is logged and reported as an internal error (500).
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({
        error: 'invalid_json',
        message: 'request body is not valid JSON',
      });
    }
    console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
    return res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
