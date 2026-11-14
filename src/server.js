// Configuration comes from the environment. For local development,
// `npm start` / `npm run dev` load an optional .env file via Node's
// built-in --env-file-if-exists flag (see package.json).
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { createServices } from './services/index.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const config = loadConfig();
const services = createServices(config);
const app = createApp({ config, services });

if (!config.apiKey) {
  console.warn(
    '[security] API_KEY is not set: /users, /documents and /cache are open to anyone who can reach this service'
  );
}

const server = app.listen(config.port, (err) => {
  if (err) {
    console.error(`failed to listen on port ${config.port}: ${err.message}`);
    process.exit(1);
  }
  console.log(`hello-devops v${config.version} listening on port ${config.port}`);
});

// Graceful shutdown: stop accepting connections, let in-flight requests
// finish, close the database clients, then exit. Kubernetes sends
// SIGTERM before removing a pod; a second signal does not restart the
// sequence, and a hard deadline guarantees the process exits.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);
  setTimeout(() => {
    console.error('shutdown timed out, exiting');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  // server.close() also closes idle keep-alive connections (Node 19+).
  server.close(async () => {
    await services.close();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
