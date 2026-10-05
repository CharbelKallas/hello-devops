/**
 * Configuration is read exclusively from environment variables so that
 * nothing host-specific or sensitive is ever hardcoded or committed.
 * Defaults are "local development" values (see .env.example).
 */
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
);

function intFrom(env, name, fallback, min, max) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}, got "${raw}"`);
  }
  return value;
}

function strFrom(env, name, fallback) {
  const raw = env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

export function loadConfig(env = process.env) {
  return {
    port: intFrom(env, 'PORT', 3000, 1, 65535),
    version: strFrom(env, 'VERSION', packageJson.version),

    // PostgreSQL — relational data (users)
    postgres: {
      host: strFrom(env, 'PGHOST', 'localhost'),
      port: intFrom(env, 'PGPORT', 5432, 1, 65535),
      database: strFrom(env, 'PGDATABASE', 'lab'),
      user: strFrom(env, 'PGUSER', 'postgres'),
      password: strFrom(env, 'PGPASSWORD', ''),
    },

    // MongoDB — document data
    mongodb: {
      uri: strFrom(env, 'MONGODB_URI', 'mongodb://localhost:27017/hello-devops'),
    },

    // Redis — cache / key-value
    redis: {
      host: strFrom(env, 'REDIS_HOST', 'localhost'),
      port: intFrom(env, 'REDIS_PORT', 6379, 1, 65535),
    },
  };
}
