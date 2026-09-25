import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

/**
 * Applies any pending SQL migrations, in filename order.
 * Safe to run on every boot: already-applied versions are skipped.
 * Each migration file must avoid semicolons inside string literals
 * (statements are split on ';').
 */
export async function migrate(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const { rows } = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE version = $1',
      [file]
    );
    if (rows.length > 0) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    // Strip full-line comments BEFORE splitting: comment text may contain
    // semicolons that are not statement terminators. (Migration files must
    // avoid semicolons inside string literals.)
    const noComments = sql
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    const statements = noComments
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const stmt of statements) {
        await client.query(stmt);
      }
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`[migrate] applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${err.message}`);
    } finally {
      client.release();
    }
  }
}
