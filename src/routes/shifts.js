import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { getPool } from '../db.js';
import { requireRole } from '../auth.js';

const router = Router();

// POST /api/shifts/clock-in { site_id }
router.post('/clock-in', async (req, res, next) => {
  try {
    const { site_id } = req.body ?? {};
    if (!site_id) return res.status(400).json({ error: 'site_id is required.' });
    const pool = getPool();

    const { rows: sites } = await pool.query('SELECT id, archived FROM sites WHERE id = $1', [site_id]);
    if (sites.length === 0 || (sites[0].archived && req.user.role === 'officer')) {
      return res.status(404).json({ error: 'Site not found.' });
    }
    if (req.user.role === 'officer') {
      const { rows: a } = await pool.query(
        'SELECT 1 FROM user_sites WHERE user_id = $1 AND site_id = $2',
        [req.user.id, site_id]
      );
      if (a.length === 0) return res.status(403).json({ error: 'You are not assigned to this site.' });
    }
    const { rows: open } = await pool.query(
      'SELECT id FROM shifts WHERE user_id = $1 AND clock_out IS NULL',
      [req.user.id]
    );
    if (open.length > 0) {
      return res.status(409).json({ error: 'You are already clocked in. Clock out first.' });
    }
    const { rows } = await pool.query(
      'INSERT INTO shifts (id, site_id, user_id) VALUES ($1, $2, $3) RETURNING *',
      [randomUUID(), site_id, req.user.id]
    );
    res.status(201).json({ shift: rows[0] });
  } catch (err) {
    next(err);
  }
});

// POST /api/shifts/clock-out
router.post('/clock-out', async (req, res, next) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE shifts SET clock_out = now() WHERE id = (
         SELECT id FROM shifts WHERE user_id = $1 AND clock_out IS NULL
         ORDER BY clock_in DESC LIMIT 1
       ) RETURNING *`,
      [req.user.id]
    );
    if (rows.length === 0) {
      return res.status(409).json({ error: 'You are not clocked in.' });
    }
    res.json({ shift: rows[0] });
  } catch (err) {
    next(err);
  }
});

// GET /api/shifts?site_id=&user_id=&date= — officers only see their own shifts.
router.get('/', async (req, res, next) => {
  try {
    const pool = getPool();
    const clauses = [];
    const params = [];
    let userId = req.query.user_id;

    if (req.user.role === 'officer') {
      userId = req.user.id; // officers can never see anyone else's shifts
    }
    if (userId) {
      params.push(userId);
      clauses.push(`s.user_id = $${params.length}`);
    }
    if (req.query.site_id) {
      params.push(req.query.site_id);
      clauses.push(`s.site_id = $${params.length}`);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '')) {
      params.push(req.query.date);
      clauses.push(`s.clock_in::date = $${params.length}::date`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT s.*, u.name AS user_name, st.name AS site_name
       FROM shifts s
       LEFT JOIN users u ON u.id = s.user_id
       JOIN sites st ON st.id = s.site_id
       ${where}
       ORDER BY s.clock_in DESC LIMIT 200`,
      params
    );
    res.json({ shifts: rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/shifts/open — the caller's currently open shift, if any
router.get('/open', async (req, res, next) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT s.*, st.name AS site_name FROM shifts s
       JOIN sites st ON st.id = s.site_id
       WHERE s.user_id = $1 AND s.clock_out IS NULL ORDER BY s.clock_in DESC LIMIT 1`,
      [req.user.id]
    );
    res.json({ shift: rows[0] || null });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/shifts/:id — Master only.
router.delete('/:id', requireRole('master'), async (req, res, next) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query('SELECT id FROM shifts WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Shift not found.' });
    await pool.query('DELETE FROM shifts WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
