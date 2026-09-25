import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { getPool } from '../db.js';
import { requireRole, siteAccess } from '../auth.js';

const router = Router();

// GET /api/sites — officers see assigned sites; master/supervisor see all.
router.get('/', async (req, res, next) => {
  try {
    const pool = getPool();
    const includeArchived = req.query.include_archived === '1' && req.user.role !== 'officer';
    if (req.user.role === 'officer') {
      const { rows } = await pool.query(
        `SELECT s.* FROM sites s
         JOIN user_sites us ON us.site_id = s.id
         WHERE us.user_id = $1 AND s.archived = FALSE ORDER BY s.name`,
        [req.user.id]
      );
      return res.json({ sites: rows });
    }
    const { rows } = await pool.query(
      `SELECT * FROM sites ${includeArchived ? '' : 'WHERE archived = FALSE'} ORDER BY name`
    );
    res.json({ sites: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/sites — master / supervisor
router.post('/', requireRole('master', 'supervisor'), async (req, res, next) => {
  try {
    const { name, address = '', notes = '' } = req.body ?? {};
    if (!name?.trim()) return res.status(400).json({ error: 'Site name is required.' });
    const pool = getPool();
    const { rows } = await pool.query(
      'INSERT INTO sites (id, name, address, notes) VALUES ($1, $2, $3, $4) RETURNING *',
      [randomUUID(), name.trim(), address.trim(), notes.trim()]
    );
    res.status(201).json({ site: rows[0] });
  } catch (err) {
    next(err);
  }
});

// GET /api/sites/:id
router.get('/:id', siteAccess, (req, res) => {
  res.json({ site: req.site });
});

// PUT /api/sites/:id — master / supervisor
router.put('/:id', requireRole('master', 'supervisor'), siteAccess, async (req, res, next) => {
  try {
    const { name, address = '', notes = '' } = req.body ?? {};
    if (!name?.trim()) return res.status(400).json({ error: 'Site name is required.' });
    const pool = getPool();
    const { rows } = await pool.query(
      'UPDATE sites SET name = $1, address = $2, notes = $3 WHERE id = $4 RETURNING *',
      [name.trim(), address.trim(), notes.trim(), req.site.id]
    );
    res.json({ site: rows[0] });
  } catch (err) {
    next(err);
  }
});

// POST /api/sites/:id/archive — master / supervisor
router.post('/:id/archive', requireRole('master', 'supervisor'), siteAccess, async (req, res, next) => {
  try {
    const pool = getPool();
    await pool.query('UPDATE sites SET archived = TRUE WHERE id = $1', [req.site.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/sites/:id/restore — master / supervisor
router.post('/:id/restore', requireRole('master', 'supervisor'), siteAccess, async (req, res, next) => {
  try {
    const pool = getPool();
    await pool.query('UPDATE sites SET archived = FALSE WHERE id = $1', [req.site.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
