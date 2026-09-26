/**
 * API test suite — runs the full Express app against an in-memory
 * Postgres (pg-mem). No Docker or real database needed.
 *
 * Run: npm test
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { newDb } from 'pg-mem';
import request from 'supertest';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

process.env.JWT_SECRET = 'test-secret-do-not-use-in-prod';
process.env.ALLOW_REGISTRATION = 'true';

let app;
let pool;
let siteId;
let otherSiteId;

// 1x1 PNG for checkpoint photo uploads
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

async function makeUser(name, email, role) {
  const id = randomUUID();
  await pool.query(
    'INSERT INTO users (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)',
    [id, name, email, await bcrypt.hash('Password123', 4), role]
  );
  return id;
}

async function loginAgent(email) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email, password: 'Password123' }).expect(200);
  return agent;
}

before(async () => {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  pool = new Pool();
  await migrate(pool);

  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-test-uploads-'));
  app = createApp({ pool, uploadDir });

  await makeUser('Test Master', 'master@test.com', 'master');
  await makeUser('Test Supervisor', 'super@test.com', 'supervisor');
  await makeUser('Test Officer', 'officer@test.com', 'officer');
  await makeUser('Unassigned Officer', 'lonely@test.com', 'officer');

  siteId = randomUUID();
  otherSiteId = randomUUID();
  await pool.query('INSERT INTO sites (id, name) VALUES ($1, $2)', [siteId, 'Test Site']);
  await pool.query('INSERT INTO sites (id, name) VALUES ($1, $2)', [otherSiteId, 'Other Site']);

  const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', ['officer@test.com']);
  await pool.query('INSERT INTO user_sites (user_id, site_id) VALUES ($1, $2)', [rows[0].id, siteId]);
});

describe('auth', () => {
  test('registration creates an unassigned officer', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Newbie', email: 'newbie@test.com', password: 'Password123' })
      .expect(201);
    assert.equal(res.body.user.role, 'officer');
    const me = await request(app).get('/api/auth/me').set('Cookie', res.headers['set-cookie']);
    assert.deepEqual(me.body.assignedSites, []);
  });

  test('registration can be closed via env', async () => {
    process.env.ALLOW_REGISTRATION = 'false';
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'X', email: 'x@test.com', password: 'Password123' })
      .expect(403);
    process.env.ALLOW_REGISTRATION = 'true';
  });

  test('login rejects bad password', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'master@test.com', password: 'wrong' })
      .expect(401);
  });

  test('protected routes require auth', async () => {
    await request(app).get('/api/sites').expect(401);
  });

  test('user can change their own password', async () => {
    const a = await loginAgent('officer@test.com');
    await a
      .post('/api/auth/password')
      .send({ currentPassword: 'wrong', newPassword: 'NewPassword123' })
      .expect(401);
    await a
      .post('/api/auth/password')
      .send({ currentPassword: 'Password123', newPassword: 'NewPassword123' })
      .expect(200);
    // new password works
    const reLogin = request.agent(app);
    await reLogin
      .post('/api/auth/login')
      .send({ email: 'officer@test.com', password: 'NewPassword123' })
      .expect(200);
    // restore the original password for the remaining tests
    await reLogin
      .post('/api/auth/password')
      .send({ currentPassword: 'NewPassword123', newPassword: 'Password123' })
      .expect(200);
  });
});

describe('role enforcement: post orders & locations', () => {
  test('officer cannot edit post orders', async () => {
    const a = await loginAgent('officer@test.com');
    await a.put(`/api/sites/${siteId}/post-orders`).send({ content: 'nope' }).expect(403);
  });

  test('supervisor cannot edit post orders', async () => {
    const a = await loginAgent('super@test.com');
    await a.put(`/api/sites/${siteId}/post-orders`).send({ content: 'nope' }).expect(403);
  });

  test('master can edit post orders, and they carry into any briefing date', async () => {
    const a = await loginAgent('master@test.com');
    await a.put(`/api/sites/${siteId}/post-orders`).send({ content: 'Standing order A' }).expect(200);
    const b = await a.get(`/api/sites/${siteId}/briefing?date=2099-01-01`).expect(200);
    assert.equal(b.body.post_orders, 'Standing order A');
    assert.equal(b.body.priorities, '');
  });

  test('officer cannot manage checkpoint locations', async () => {
    const a = await loginAgent('officer@test.com');
    await a.post(`/api/sites/${siteId}/locations`).send({ name: 'Roof' }).expect(403);
  });

  test('supervisor cannot manage checkpoint locations', async () => {
    const a = await loginAgent('super@test.com');
    await a.post(`/api/sites/${siteId}/locations`).send({ name: 'Roof' }).expect(403);
    await a.delete(`/api/sites/${siteId}/locations/whatever`).send().expect(403);
  });

  test('master can add and remove locations', async () => {
    const a = await loginAgent('master@test.com');
    const created = await a.post(`/api/sites/${siteId}/locations`).send({ name: 'North Gate' }).expect(201);
    await a.delete(`/api/sites/${siteId}/locations/${created.body.location.id}`).expect(200);
  });
});

describe('briefings', () => {
  test('supervisor can save a briefing; officer cannot', async () => {
    const s = await loginAgent('super@test.com');
    await s
      .put(`/api/sites/${siteId}/briefing`)
      .send({ date: '2026-09-16', priorities: 'Watch the gate.', handoff_notes: 'All quiet.' })
      .expect(200);
    const o = await loginAgent('officer@test.com');
    await o
      .put(`/api/sites/${siteId}/briefing`)
      .send({ date: '2026-09-16', priorities: 'x', handoff_notes: 'y' })
      .expect(403);
    const b = await o.get(`/api/sites/${siteId}/briefing?date=2026-09-16`).expect(200);
    assert.equal(b.body.priorities, 'Watch the gate.');
  });
});

describe('shifts', () => {
  test('officer clock in/out lifecycle', async () => {
    const a = await loginAgent('officer@test.com');
    await a.post('/api/shifts/clock-in').send({ site_id: siteId }).expect(201);
    await a.post('/api/shifts/clock-in').send({ site_id: siteId }).expect(409); // already in
    const open = await a.get('/api/shifts/open').expect(200);
    assert.ok(open.body.shift);
    await a.post('/api/shifts/clock-out').expect(200);
    await a.post('/api/shifts/clock-out').expect(409); // not in
  });

  test('officer cannot clock in at an unassigned site', async () => {
    const a = await loginAgent('officer@test.com');
    await a.post('/api/shifts/clock-in').send({ site_id: otherSiteId }).expect(403);
  });

  test('unassigned officer sees no sites', async () => {
    const a = await loginAgent('lonely@test.com');
    const res = await a.get('/api/sites').expect(200);
    assert.deepEqual(res.body.sites, []);
  });

  test('officer cannot list other officers shifts', async () => {
    const a = await loginAgent('officer@test.com');
    const res = await a.get('/api/shifts?user_id=someone-else').expect(200);
    assert.ok(res.body.shifts.every((s) => s.user_name === 'Test Officer'));
  });
});

describe('reports', () => {
  let reportId;
  test('officer can file a report', async () => {
    const a = await loginAgent('officer@test.com');
    const res = await a
      .post(`/api/sites/${siteId}/reports`)
      .send({ title: 'Broken light', body: 'Lot B lamp out', severity: 'routine' })
      .expect(201);
    reportId = res.body.report.id;
    assert.equal(res.body.report.status, 'open');
  });

  test('officer cannot change report status', async () => {
    const a = await loginAgent('officer@test.com');
    await a.patch(`/api/sites/${siteId}/reports/${reportId}`).send({ status: 'resolved' }).expect(403);
  });

  test('supervisor can resolve and reopen', async () => {
    const a = await loginAgent('super@test.com');
    await a.patch(`/api/sites/${siteId}/reports/${reportId}`).send({ status: 'resolved' }).expect(200);
    const list = await a.get(`/api/sites/${siteId}/reports?status=resolved`).expect(200);
    assert.ok(list.body.reports.some((r) => r.id === reportId));
    await a.patch(`/api/sites/${siteId}/reports/${reportId}`).send({ status: 'open' }).expect(200);
  });
});

describe('checkpoints', () => {
  test('checkpoint requires a photo', async () => {
    const a = await loginAgent('officer@test.com');
    await a.post(`/api/sites/${siteId}/checkpoints`).field('new_location', 'Roof').expect(400);
  });

  test('officer ad-hoc location is stored on the checkpoint, not auto-saved', async () => {
    const a = await loginAgent('officer@test.com');
    const res = await a
      .post(`/api/sites/${siteId}/checkpoints`)
      .field('new_location', 'Officer Roof Spot')
      .field('note', 'all clear')
      .attach('photo', PNG, 'photo.png')
      .expect(201);
    assert.equal(res.body.checkpoint.location_name, 'Officer Roof Spot');
    assert.equal(res.body.checkpoint.location_id, null);
    assert.ok(res.body.checkpoint.photo_url.startsWith('/uploads/'));
    const locs = await a.get(`/api/sites/${siteId}/locations`).expect(200);
    assert.ok(!locs.body.locations.some((l) => l.name === 'Officer Roof Spot'));
  });

  test('master new location is auto-saved as a standing location', async () => {
    const a = await loginAgent('master@test.com');
    const res = await a
      .post(`/api/sites/${siteId}/checkpoints`)
      .field('new_location', 'Master Basement')
      .attach('photo', PNG, 'photo.png')
      .expect(201);
    assert.ok(res.body.checkpoint.location_id);
    const locs = await a.get(`/api/sites/${siteId}/locations`).expect(200);
    assert.ok(locs.body.locations.some((l) => l.name === 'Master Basement'));
  });

  test('checkpoint log lists entries with photo urls', async () => {
    const a = await loginAgent('officer@test.com');
    const res = await a.get(`/api/sites/${siteId}/checkpoints`).expect(200);
    assert.ok(res.body.checkpoints.length >= 2);
  });
});

describe('team management', () => {
  test('officer cannot list users', async () => {
    const a = await loginAgent('officer@test.com');
    await a.get('/api/users').expect(403);
  });

  test('supervisor cannot grant master role', async () => {
    const s = await loginAgent('super@test.com');
    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', ['lonely@test.com']);
    await s.patch(`/api/users/${rows[0].id}/role`).send({ role: 'master' }).expect(403);
  });

  test('supervisor can promote officer to supervisor', async () => {
    const s = await loginAgent('super@test.com');
    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', ['lonely@test.com']);
    await s.patch(`/api/users/${rows[0].id}/role`).send({ role: 'supervisor' }).expect(200);
    // restore
    const m = await loginAgent('master@test.com');
    await m.patch(`/api/users/${rows[0].id}/role`).send({ role: 'officer' }).expect(200);
  });

  test('master cannot demote themselves or the last master', async () => {
    const m = await loginAgent('master@test.com');
    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', ['master@test.com']);
    await m.patch(`/api/users/${rows[0].id}/role`).send({ role: 'officer' }).expect(403);
  });

  test('site assignment grants officer access', async () => {
    const m = await loginAgent('master@test.com');
    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', ['lonely@test.com']);
    await m.post(`/api/users/${rows[0].id}/sites`).send({ site_ids: [otherSiteId] }).expect(200);
    const o = await loginAgent('lonely@test.com');
    const sites = await o.get('/api/sites').expect(200);
    assert.ok(sites.body.sites.some((s) => s.id === otherSiteId));
  });

  test('master can create an account directly', async () => {
    const m = await loginAgent('master@test.com');
    const res = await m.post('/api/users')
      .send({ name: 'New Hire', email: 'newhire@test.com', password: 'Password123', role: 'supervisor' })
      .expect(201);
    assert.equal(res.body.user.email, 'newhire@test.com');
    assert.equal(res.body.user.role, 'supervisor');
    assert.ok(!('password_hash' in res.body.user), 'must not leak password hash');
    // and the new account can sign in
    await request(app).post('/api/auth/login')
      .send({ email: 'newhire@test.com', password: 'Password123' })
      .expect(200);
  });

  test('account creation defaults to officer', async () => {
    const m = await loginAgent('master@test.com');
    const res = await m.post('/api/users')
      .send({ name: 'Rookie', email: 'rookie@test.com', password: 'Password123' })
      .expect(201);
    assert.equal(res.body.user.role, 'officer');
  });

  test('supervisor and officer cannot create accounts', async () => {
    const s = await loginAgent('super@test.com');
    await s.post('/api/users')
      .send({ name: 'X', email: 'x@test.com', password: 'Password123' })
      .expect(403);
    const o = await loginAgent('officer@test.com');
    await o.post('/api/users')
      .send({ name: 'Y', email: 'y@test.com', password: 'Password123' })
      .expect(403);
  });

  test('account creation validates input', async () => {
    const m = await loginAgent('master@test.com');
    await m.post('/api/users').send({ name: 'Z', email: 'z@test.com' }).expect(400); // no password
    await m.post('/api/users').send({ name: 'Z', email: 'z@test.com', password: 'short' }).expect(400);
    await m.post('/api/users').send({ name: 'Z', email: 'not-an-email', password: 'Password123' }).expect(400);
    await m.post('/api/users').send({ name: 'Z', email: 'z2@test.com', password: 'Password123', role: 'ceo' }).expect(400);
    await m.post('/api/users').send({ name: 'Dup', email: 'officer@test.com', password: 'Password123' }).expect(409);
  });

  test('master can delete an officer', async () => {
    const m = await loginAgent('master@test.com');
    const created = await m.post('/api/users')
      .send({ name: 'Temp', email: 'temp@test.com', password: 'Password123' })
      .expect(201);
    await m.delete(`/api/users/${created.body.user.id}`).expect(200);
    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', ['temp@test.com']);
    assert.equal(rows.length, 0);
  });

  test('master cannot delete themselves or the last master', async () => {
    const m = await loginAgent('master@test.com');
    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', ['master@test.com']);
    await m.delete(`/api/users/${rows[0].id}`).expect(403);
    // create a second master, delete them (allowed), then last master is protected
    const second = await m.post('/api/users')
      .send({ name: 'Master2', email: 'master2@test.com', password: 'Password123', role: 'master' })
      .expect(201);
    await m.delete(`/api/users/${second.body.user.id}`).expect(200);
    await m.delete(`/api/users/${rows[0].id}`).expect(403); // self — still blocked
  });

  test('supervisor cannot delete users', async () => {
    const s = await loginAgent('super@test.com');
    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', ['lonely@test.com']);
    await s.delete(`/api/users/${rows[0].id}`).expect(403);
  });

  test('deleting a missing user is 404', async () => {
    const m = await loginAgent('master@test.com');
    await m.delete('/api/users/00000000-0000-0000-0000-000000000000').expect(404);
  });
});

describe('record retention', () => {
  test('deleting a user keeps their shifts, reports and checkpoints', async () => {
    const m = await loginAgent('master@test.com');
    const created = await m.post('/api/users')
      .send({ name: 'Gone Officer', email: 'gone@test.com', password: 'Password123' })
      .expect(201);
    const uid = created.body.user.id;
    const shiftId = randomUUID(), reportId = randomUUID(), cpId = randomUUID();
    await pool.query('INSERT INTO shifts (id, site_id, user_id, clock_in, clock_out) VALUES ($1, $2, $3, $4, $5)',
      [shiftId, siteId, uid, new Date(Date.now() - 8 * 3600000), new Date(Date.now() - 3600000)]);
    await pool.query('INSERT INTO reports (id, site_id, user_id, title) VALUES ($1, $2, $3, $4)',
      [reportId, siteId, uid, 'Gone report']);
    await pool.query('INSERT INTO checkpoints (id, site_id, location_name, user_id) VALUES ($1, $2, $3, $4)',
      [cpId, siteId, 'Gate', uid]);

    await m.delete(`/api/users/${uid}`).expect(200);

    for (const [tbl, id] of [['shifts', shiftId], ['reports', reportId], ['checkpoints', cpId]]) {
      const { rows } = await pool.query(`SELECT user_id FROM ${tbl} WHERE id = $1`, [id]);
      assert.equal(rows.length, 1, `${tbl} row survived user deletion`);
      assert.equal(rows[0].user_id, null, `${tbl} author cleared`);
    }
    // orphaned rows still appear in listings (LEFT JOIN)
    const shifts = await m.get(`/api/shifts?site_id=${siteId}`).expect(200);
    assert.ok(shifts.body.shifts.some((s) => s.id === shiftId && s.user_name === null));
    const reports = await m.get(`/api/sites/${siteId}/reports?status=all`).expect(200);
    assert.ok(reports.body.reports.some((r) => r.id === reportId && r.user_name === null));
    const cps = await m.get(`/api/sites/${siteId}/checkpoints`).expect(200);
    assert.ok(cps.body.checkpoints.some((c) => c.id === cpId && c.user_name === null));
  });

  test('master can delete individual records; officers and supervisors cannot', async () => {
    const m = await loginAgent('master@test.com');
    const o = await loginAgent('officer@test.com');
    const s = await loginAgent('super@test.com');
    const { rows: ou } = await pool.query('SELECT id FROM users WHERE email = $1', ['officer@test.com']);
    const uid = ou[0].id;

    const shId = randomUUID();
    await pool.query('INSERT INTO shifts (id, site_id, user_id) VALUES ($1, $2, $3)', [shId, siteId, uid]);
    await o.delete(`/api/shifts/${shId}`).expect(403);
    await s.delete(`/api/shifts/${shId}`).expect(403);
    await m.delete(`/api/shifts/${shId}`).expect(200);
    await m.delete(`/api/shifts/${shId}`).expect(404);

    const rId = randomUUID();
    await pool.query('INSERT INTO reports (id, site_id, user_id, title) VALUES ($1, $2, $3, $4)',
      [rId, siteId, uid, 'deletable']);
    await s.delete(`/api/sites/${siteId}/reports/${rId}`).expect(403);
    await m.delete(`/api/sites/${siteId}/reports/${rId}`).expect(200);
    await m.delete(`/api/sites/${siteId}/reports/${rId}`).expect(404);

    const cpId = randomUUID();
    await pool.query(
      'INSERT INTO checkpoints (id, site_id, location_name, user_id, photo_path) VALUES ($1, $2, $3, $4, $5)',
      [cpId, siteId, 'Gate', uid, 'missing.png']
    );
    await o.delete(`/api/sites/${siteId}/checkpoints/${cpId}`).expect(403);
    await m.delete(`/api/sites/${siteId}/checkpoints/${cpId}`).expect(200);
    const { rows } = await pool.query('SELECT id FROM checkpoints WHERE id = $1', [cpId]);
    assert.equal(rows.length, 0);
  });

  test('purgeOldPhotos expires photo files after 30 days but keeps records', async () => {
    const { purgeOldPhotos } = await import('../src/purge.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onpost-purge-test-'));
    fs.writeFileSync(path.join(dir, 'old.png'), PNG);
    fs.writeFileSync(path.join(dir, 'new.png'), PNG);
    const { rows: ou } = await pool.query('SELECT id FROM users WHERE email = $1', ['officer@test.com']);
    const oldId = randomUUID(), newId = randomUUID();
    await pool.query(
      'INSERT INTO checkpoints (id, site_id, location_name, user_id, photo_path, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [oldId, siteId, 'Old gate', ou[0].id, 'old.png', new Date(Date.now() - 31 * 86400000)]
    );
    await pool.query(
      'INSERT INTO checkpoints (id, site_id, location_name, user_id, photo_path, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [newId, siteId, 'New gate', ou[0].id, 'new.png', new Date(Date.now() - 86400000)]
    );

    const purged = await purgeOldPhotos(pool, dir);
    assert.equal(purged, 1);
    assert.ok(!fs.existsSync(path.join(dir, 'old.png')), 'expired photo file deleted');
    assert.ok(fs.existsSync(path.join(dir, 'new.png')), 'recent photo file kept');
    const { rows } = await pool.query(
      'SELECT id, photo_path FROM checkpoints WHERE id IN ($1, $2)', [oldId, newId]
    );
    assert.equal(rows.length, 2, 'both checkpoint records survive');
    assert.equal(rows.find((r) => r.id === oldId).photo_path, null);
    assert.equal(rows.find((r) => r.id === newId).photo_path, 'new.png');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('first-user bootstrap', () => {
  test('first registration on a fresh database becomes master', async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const freshPool = new Pool();
    await migrate(freshPool);
    const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-bootstrap-test-'));
    const freshApp = createApp({ pool: freshPool, uploadDir });

    const first = await request(freshApp)
      .post('/api/auth/register')
      .send({ name: 'First', email: 'first@test.com', password: 'Password123' })
      .expect(201);
    assert.equal(first.body.user.role, 'master');

    const second = await request(freshApp)
      .post('/api/auth/register')
      .send({ name: 'Second', email: 'second@test.com', password: 'Password123' })
      .expect(201);
    assert.equal(second.body.user.role, 'officer');
    await freshPool.end();
  });
});
