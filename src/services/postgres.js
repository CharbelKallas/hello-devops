import pg from 'pg';
import { ConflictError } from '../errors.js';

const { Pool } = pg;

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
 * fail fast (connectionTimeoutMillis) and the route answers 503. The
 * schema is ensured lazily once per process; a failed attempt is
 * forgotten so the next request retries.
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
  });

  let schema = null;
  function ensureSchema() {
    if (!schema) {
      schema = pool.query(CREATE_USERS_TABLE).catch((err) => {
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
      try {
        const { rows } = await pool.query(
          'INSERT INTO users (name, email) VALUES ($1, $2) ' +
            'RETURNING id, name, email, created_at',
          [name, email]
        );
        return toApi(rows[0]);
      } catch (err) {
        // unique_violation — the email column is UNIQUE
        if (err.code === '23505') {
          throw new ConflictError('a user with this email already exists');
        }
        throw err;
      }
    },

    async get(id) {
      await ensureSchema();
      const { rows } = await pool.query(
        'SELECT id, name, email, created_at FROM users WHERE id = $1',
        [id]
      );
      return rows[0] ? toApi(rows[0]) : null;
    },

    async ping() {
      await pool.query('SELECT 1');
      return true;
    },

    async close() {
      await pool.end();
    },
  };
}
