import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { getPool } from '../db.js';
import { requireRole, siteAccess } from '../auth.js';

const router = Router({ mergeParams: true });
const SEVERITIES = ['routine', 'urgent', 'critical'];

// GET /api/sites/:siteId/reports?status=open|resolved
router.get('/', siteAccess, async (req, res, next) => {
  try {
    const pool = getPool();
    const clauses = ['r.site_id = $1'];
    const params = [req.site.id];
    if (['open', 'resolved'].includes(req.query.status)) {
      params.push(req.query.status);
      clauses.push(`r.status = $${params.length}`);
    }
    const { rows } = await pool.query(
      `SELECT r.*, u.name AS user_name FROM reports r
       LEFT JOIN users u ON u.id = r.user_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY r.created_at DESC LIMIT 200`,
      params
    );
    res.json({ reports: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/sites/:siteId/reports — officers and up can file reports.
router.post('/', siteAccess, async (req, res, next) => {
  try {
    const { title, body = '', severity = 'routine' } = req.body ?? {};
    if (!title?.trim()) return res.status(400).json({ error: 'A title is required.' });
    if (!SEVERITIES.includes(severity)) return res.status(400).json({ error: 'Invalid severity.' });
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO reports (id, site_id, user_id, title, body, severity)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [randomUUID(), req.site.id, req.user.id, title.trim(), body.trim(), severity]
    );
    res.status(201).json({ report: rows[0] });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/sites/:siteId/reports/:reportId — master / supervisor only (status + corrections).
router.patch('/:reportId', requireRole('master', 'supervisor'), siteAccess, async (req, res, next) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query('SELECT * FROM reports WHERE id = $1 AND site_id = $2', [
      req.params.reportId,
      req.site.id,
    ]);
    if (rows.length === 0) return res.status(404).json({ error: 'Report not found.' });

    const updates = [];
    const params = [];
    const { status, title, body, severity } = req.body ?? {};
    if (status !== undefined) {
      if (!['open', 'resolved'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status.' });
      }
      params.push(status);
      updates.push(`status = $${params.length}`);
    }
    if (title !== undefined) {
      if (!title.trim()) return res.status(400).json({ error: 'Title cannot be blank.' });
      params.push(title.trim());
      updates.push(`title = $${params.length}`);
    }
    if (body !== undefined) {
      params.push(body.trim());
      updates.push(`body = $${params.length}`);
    }
    if (severity !== undefined) {
      if (!SEVERITIES.includes(severity)) return res.status(400).json({ error: 'Invalid severity.' });
      params.push(severity);
      updates.push(`severity = $${params.length}`);
    }
    if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update.' });

    params.push(req.params.reportId);
    const { rows: updated } = await pool.query(
      `UPDATE reports SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    res.json({ report: updated[0] });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/sites/:siteId/reports/:id — Master only.
router.delete('/:id', requireRole('master'), siteAccess, async (req, res, next) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      'SELECT id FROM reports WHERE id = $1 AND site_id = $2',
      [req.params.id, req.site.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Report not found.' });
    await pool.query('DELETE FROM reports WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
