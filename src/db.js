import pg from 'pg';

const { Pool } = pg;

let pool = null;

/**
 * Returns the shared Postgres connection pool.
 * In production this is created from DATABASE_URL (+ optional PGSSLMODE).
 * Tests inject their own pool via setPool().
 */
export function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and fill it in, ' +
      'or run with docker compose (see README.md).'
    );
  }
  const ssl =
    process.env.PGSSLMODE === 'require'
      ? { rejectUnauthorized: false }
      : undefined;
  pool = new Pool({ connectionString, ssl });
  return pool;
}

/** Test hook: use an in-memory pool instead of a real database. */
export function setPool(p) {
  pool = p;
}
