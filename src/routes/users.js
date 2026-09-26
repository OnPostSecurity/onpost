import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { getPool } from '../db.js';
import { requireRole } from '../auth.js';

const router = Router();
const VALID_ROLES = ['master', 'supervisor', 'officer'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Everyone on these routes must be master or supervisor (mounted with requireAuth already).
router.use(requireRole('master', 'supervisor'));

// POST /api/users — Master only: create an account directly (invite-only
// onboarding once open registration is turned off).
router.post('/', requireRole('master'), async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body ?? {};
    if (!name?.trim() || !email?.trim() || !password) {
      return res.status(400).json({ error: 'Name, email and password are required.' });
    }
    if (!EMAIL_RE.test(email.trim())) {
      return res.status(400).json({ error: 'That email address does not look valid.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    const finalRole = role || 'officer';
    if (!VALID_ROLES.includes(finalRole)) {
      return res.status(400).json({ error: 'Invalid role.' });
    }
    const pool = getPool();
    const existing = await pool.query('SELECT 1 FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }
    const id = randomUUID();
    const password_hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO users (id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, role, created_at`,
      [id, name.trim(), email.trim().toLowerCase(), password_hash, finalRole]
    );
    res.status(201).json({ user: rows[0] });
  } catch (err) {
    next(err);
  }
});

// GET /api/users — roster with roles + site assignments
router.get('/', async (req, res, next) => {
  try {
    const pool = getPool();
    const { rows: users } = await pool.query(
      'SELECT id, name, email, role, created_at FROM users ORDER BY created_at'
    );
    const { rows: assignments } = await pool.query(
      `SELECT us.user_id, s.id AS site_id, s.name AS site_name
       FROM user_sites us JOIN sites s ON s.id = us.site_id ORDER BY s.name`
    );
    const byUser = {};
    for (const a of assignments) {
      (byUser[a.user_id] ||= []).push({ id: a.site_id, name: a.site_name });
    }
    res.json({
      users: users.map((u) => ({ ...u, sites: byUser[u.id] || [] })),
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/users/:id/role — Master: anything. Supervisor: only officer<->supervisor,
// never touching a master, never themselves.
router.patch('/:id/role', async (req, res, next) => {
  try {
    const { role } = req.body ?? {};
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Invalid role.' });
    }
    const pool = getPool();
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    const target = rows[0];

    if (req.user.role === 'supervisor') {
      if (target.role === 'master' || role === 'master') {
        return res.status(403).json({ error: 'Only a Master can assign the Master role.' });
      }
      if (target.id === req.user.id) {
        return res.status(403).json({ error: 'You cannot change your own role.' });
      }
    }
    if (req.user.role === 'master' && target.id === req.user.id && role !== 'master') {
      return res.status(403).json({ error: 'You cannot demote yourself.' });
    }
    // Never leave the company without a master.
    if (target.role === 'master' && role !== 'master') {
      const { rows: masters } = await pool.query(
        "SELECT COUNT(*)::int AS n FROM users WHERE role = 'master'"
      );
      if (masters[0].n <= 1) {
        return res.status(400).json({ error: 'You cannot demote the last Master account.' });
      }
    }
    await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, target.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/users/:id — Master only. Cannot delete yourself or the last Master.
// The user's shifts, checkpoints and reports are deleted with them (ON DELETE
// CASCADE); post orders / briefings they touched keep working (SET NULL).
router.delete('/:id', requireRole('master'), async (req, res, next) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    const target = rows[0];
    if (target.id === req.user.id) {
      return res.status(403).json({ error: 'You cannot delete your own account.' });
    }
    if (target.role === 'master') {
      const { rows: masters } = await pool.query(
        "SELECT COUNT(*)::int AS n FROM users WHERE role = 'master'"
      );
      if (masters[0].n <= 1) {
        return res.status(400).json({ error: 'You cannot delete the last Master account.' });
      }
    }
    await pool.query('DELETE FROM users WHERE id = $1', [target.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/users/:id/sites — replace an officer's site assignments
router.post('/:id/sites', async (req, res, next) => {
  try {
    const { site_ids } = req.body ?? {};
    if (!Array.isArray(site_ids)) {
      return res.status(400).json({ error: 'site_ids must be an array.' });
    }
    const pool = getPool();
    const { rows } = await pool.query('SELECT id FROM users WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found.' });

    // Validate every site id before touching assignments.
    if (site_ids.length > 0) {
      const uniqueIds = [...new Set(site_ids)];
      const placeholders = uniqueIds.map((_, i) => `$${i + 1}`).join(', ');
      const { rows: found } = await pool.query(
        `SELECT id FROM sites WHERE id IN (${placeholders}) AND archived = FALSE`,
        uniqueIds
      );
      if (found.length !== uniqueIds.length) {
        return res.status(400).json({ error: 'One or more site IDs are invalid.' });
      }
    }
    await pool.query('DELETE FROM user_sites WHERE user_id = $1', [req.params.id]);
    for (const siteId of site_ids) {
      await pool.query('INSERT INTO user_sites (user_id, site_id) VALUES ($1, $2)', [
        req.params.id,
        siteId,
      ]);
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
