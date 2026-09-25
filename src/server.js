import 'dotenv/config';
import { getPool } from './db.js';
import { migrate } from './migrate.js';
import { createApp } from './app.js';

async function waitForDb(pool, attempts = 30) {
  for (let i = 0; i < attempts; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (i === attempts - 1) throw err;
      console.log(`[server] waiting for database... (${i + 1}/${attempts})`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function main() {
  const pool = getPool();
  await waitForDb(pool);
  await migrate(pool); // schema is always brought up to date on boot

  const app = createApp();
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    console.log(`OnPost listening on http://localhost:${port}`);
  });
}

main().catch((err) => {
  console.error('[server] fatal:', err.message);
  process.exit(1);
});
