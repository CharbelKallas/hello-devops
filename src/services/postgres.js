import pg from 'pg';
import { ConflictError, ServiceUnavailableError, describeError } from '../errors.js';

const { Pool } = pg;
const SERVICE = 'postgresql';

// SQLSTATE classes that mean "our query or data is wrong" rather than
// "the database is unavailable": data exceptions (22), integrity
// violations (23) and syntax/undefined-object errors (42). These are
// bugs and must surface as 500s, not as a database outage.
const BUG_SQLSTATE_CLASSES = new Set(['22', '23', '42']);

function isBug(err) {
  return (
    typeof err.code === 'string' &&
    /^[0-9A-Z]{5}$/.test(err.code) &&
    BUG_SQLSTATE_CLASSES.has(err.code.slice(0, 2))
  );
}

const CREATE_USERS_TABLE = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

/**
 * PostgreSQL access for the `users` table.
 *
 * The Pool does not connect eagerly — if PostgreSQL is down, queries
 * fail fast (connectionTimeoutMillis / query_timeout) and the route
 * answers 503. The schema is ensured lazily once per process; a failed
 * attempt is forgotten so the next request retries.
 */
export function createPostgresUsers({ host, port, database, user, password }) {
  const pool = new Pool({
    host,
    port,
    database,
    user,
    password,
    max: 5,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10_000,
    // Client-side deadline for every query, so a stalled connection
    // cannot hang a request.
    query_timeout: 5000,
  });

  // REQUIRED by node-postgres: an idle pooled client that loses its
  // connection (e.g. PostgreSQL restarts) emits 'error' on the pool.
  // Without a listener that event crashes the whole process. The broken
  // client is discarded by the pool automatically.
  pool.on('error', (err) => {
    console.warn(`[${SERVICE}] idle client error: ${describeError(err)}`);
  });

  async function query(text, params) {
    try {
      return await pool.query(text, params);
    } catch (err) {
      // unique_violation — the email column is UNIQUE
      if (err.code === '23505') {
        throw new ConflictError('a user with this email already exists');
      }
      if (isBug(err)) throw err;
      throw new ServiceUnavailableError(SERVICE, err);
    }
  }

  let schema = null;
  function ensureSchema() {
    if (!schema) {
      // Not via query(): when several replicas start at once,
      // CREATE TABLE IF NOT EXISTS can still race and fail with a
      // unique_violation on PostgreSQL's own catalog (23505) or
      // duplicate_table (42P07) — both mean "another replica just
      // created it", not a duplicate user.
      schema = pool
        .query(CREATE_USERS_TABLE)
        .catch((err) => {
          if (err.code === '23505' || err.code === '42P07') return;
          throw isBug(err) ? err : new ServiceUnavailableError(SERVICE, err);
        })
        .catch((err) => {
          schema = null;
          throw err;
        });
    }
    return schema;
  }

  function toApi(row) {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      createdAt: row.created_at,
    };
  }

  return {
    async create({ name, email }) {
      await ensureSchema();
      const { rows } = await query(
        'INSERT INTO users (name, email) VALUES ($1, $2) ' +
          'RETURNING id, name, email, created_at',
        [name, email]
      );
      return toApi(rows[0]);
    },

    async get(id) {
      await ensureSchema();
      const { rows } = await query(
        'SELECT id, name, email, created_at FROM users WHERE id = $1',
        [id]
      );
      return rows[0] ? toApi(rows[0]) : null;
    },

    async ping() {
      await query('SELECT 1');
      return true;
    },

    async close() {
      await pool.end();
    },
  };
}
