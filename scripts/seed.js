#!/usr/bin/env node
/**
 * DEMO SEED — creates a demo Master account and sample site data.
 * Clearly marked as demo content: delete these accounts before selling
 * access to real customers (or just don't run this in production).
 *
 * Usage: npm run seed
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { getPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';

const DEMO_MASTER = { name: 'Demo Master', email: 'master@example.com', password: 'Master123!' };
const DEMO_OFFICER = { name: 'Demo Officer', email: 'officer@example.com', password: 'Officer123!' };

async function main() {
  const pool = getPool();
  await migrate(pool);

  async function ensureUser({ name, email, password, role }) {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      console.log(`[seed] user ${email} already exists, skipping`);
      return existing.rows[0].id;
    }
    const id = randomUUID();
    await pool.query(
      'INSERT INTO users (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)',
      [id, name, email, await bcrypt.hash(password, 12), role]
    );
    console.log(`[seed] created ${role}: ${email}`);
    return id;
  }

  const masterId = await ensureUser({ ...DEMO_MASTER, role: 'master' });
  const officerId = await ensureUser({ ...DEMO_OFFICER, role: 'officer' });

  // Sample site
  let siteId;
  const { rows: existingSites } = await pool.query('SELECT id FROM sites WHERE name = $1', [
    'Riverside Plaza (Demo)',
  ]);
  if (existingSites.length > 0) {
    siteId = existingSites[0].id;
    console.log('[seed] demo site already exists, skipping site seed');
  } else {
    siteId = randomUUID();
    await pool.query(
      'INSERT INTO sites (id, name, address, notes) VALUES ($1, $2, $3, $4)',
      [siteId, 'Riverside Plaza (Demo)', '100 Demo Ave', 'Demo data — delete before production use.']
    );
    await pool.query(
      'INSERT INTO post_orders (site_id, content, updated_by) VALUES ($1, $2, $3)',
      [
        siteId,
        '1. Patrol the parking structure every hour.\n2. Verify all lobby doors are secured after 22:00.\n3. Log every visitor at the front desk.',
        masterId,
      ]
    );
    for (const loc of ['North Gate', 'Parking Structure L2', 'Main Lobby']) {
      await pool.query('INSERT INTO checkpoint_locations (id, site_id, name) VALUES ($1, $2, $3)', [
        randomUUID(),
        siteId,
        loc,
      ]);
    }
    const today = new Date().toISOString().slice(0, 10);
    await pool.query(
      'INSERT INTO briefings (site_id, date, priorities, handoff_notes, updated_by) VALUES ($1, $2, $3, $4, $5)',
      [siteId, today, 'Watch for the broken gate arm on the north entrance.', 'Overnight crew: generator test at 02:00.', masterId]
    );
    await pool.query(
      `INSERT INTO reports (id, site_id, user_id, title, body, severity)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), siteId, masterId, 'Demo: gate arm malfunction', 'North entrance gate arm is stuck half-open. Maintenance notified.', 'urgent']
    );
    console.log('[seed] created demo site with post orders, locations, briefing, and a report');
  }

  // Assign the demo officer to the demo site
  await pool.query(
    'INSERT INTO user_sites (user_id, site_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [officerId, siteId]
  );

  console.log('\n[seed] DONE — demo accounts (change or delete these before production):');
  console.log(`  Master : ${DEMO_MASTER.email} / ${DEMO_MASTER.password}`);
  console.log(`  Officer: ${DEMO_OFFICER.email} / ${DEMO_OFFICER.password}`);

  await pool.end();
}

main().catch((err) => {
  console.error('[seed] fatal:', err.message);
  process.exit(1);
});
