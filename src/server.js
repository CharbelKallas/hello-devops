import 'dotenv/config';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { createServices } from './services/index.js';

const config = loadConfig();
const services = createServices(config);
const app = createApp({ config, services });

const server = app.listen(config.port, () => {
  console.log(`hello-devops v${config.version} listening on port ${config.port}`);
});

// Graceful shutdown: stop accepting connections, close the database
// clients, then exit. Kubernetes sends SIGTERM before removing a pod
// from the Service.
function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(async () => {
    await services.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
