#!/usr/bin/env node
// npm run migrate — applies pending migrations without starting the server.
import 'dotenv/config';
import { getPool } from './db.js';
import { migrate } from './migrate.js';

const pool = getPool();
try {
  await migrate(pool);
  console.log('[migrate] up to date');
} finally {
  await pool.end();
}
