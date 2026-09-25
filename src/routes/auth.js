import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { getPool } from '../db.js';
import { requireAuth, setAuthCookie, clearAuthCookie } from '../auth.js';

const router = Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, created_at: u.created_at };
}

// POST /api/auth/register — open registration creates an unassigned Officer.
// A Master/Supervisor must assign them to sites before they can do anything.
router.post('/register', async (req, res, next) => {
  try {
    if (process.env.ALLOW_REGISTRATION !== 'true') {
      return res.status(403).json({ error: 'Registration is closed. Ask your supervisor for an account.' });
    }
    const { name, email, password } = req.body ?? {};
    if (!name?.trim() || !email?.trim() || !password) {
      return res.status(400).json({ error: 'Name, email and password are required.' });
    }
    if (!EMAIL_RE.test(email.trim())) {
      return res.status(400).json({ error: 'That email address does not look valid.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    const pool = getPool();
    const existing = await pool.query('SELECT 1 FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }
    const id = randomUUID();
    const password_hash = await bcrypt.hash(password, 12);
    // Bootstrap: the very first account on a fresh database becomes Master,
    // so there's always a way in without shell access. Everyone after is Officer.
    const { rows: countRows } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
    const role = countRows[0].n === 0 ? 'master' : 'officer';
    const { rows } = await pool.query(
      `INSERT INTO users (id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, role, created_at`,
      [id, name.trim(), email.trim().toLowerCase(), password_hash, role]
    );
    setAuthCookie(res, rows[0]);
    res.status(201).json({ user: publicUser(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email?.trim() || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    const pool = getPool();
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    const ok = await bcrypt.compare(password, rows[0].password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    setAuthCookie(res, rows[0]);
    res.json({ user: publicUser(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/password — change your own password
router.post('/password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new passwords are required.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    }
    const pool = getPool();
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const ok = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [
      await bcrypt.hash(newPassword, 12),
      req.user.id,
    ]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT s.id, s.name FROM sites s
       JOIN user_sites us ON us.site_id = s.id
       WHERE us.user_id = $1 AND s.archived = FALSE ORDER BY s.name`,
      [req.user.id]
    );
    res.json({ user: publicUser(req.user), assignedSites: rows });
  } catch (err) {
    next(err);
  }
});

export default router;
