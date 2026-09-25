import { Router } from 'express';
import { getPool } from '../db.js';
import { requireRole, siteAccess } from '../auth.js';

const router = Router({ mergeParams: true });

// GET /api/sites/:siteId/post-orders — everyone with site access can read.
router.get('/', siteAccess, async (req, res, next) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query('SELECT content, updated_at FROM post_orders WHERE site_id = $1', [
      req.site.id,
    ]);
    res.json({ site_id: req.site.id, content: rows[0]?.content ?? '', updated_at: rows[0]?.updated_at ?? null });
  } catch (err) {
    next(err);
  }
});

// PUT /api/sites/:siteId/post-orders — MASTER ONLY. Standing instructions;
// saved once, carried over day to day until edited here.
router.put('/', requireRole('master'), siteAccess, async (req, res, next) => {
  try {
    const { content = '' } = req.body ?? {};
    const pool = getPool();
    const existing = await pool.query('SELECT 1 FROM post_orders WHERE site_id = $1', [req.site.id]);
    if (existing.rows.length > 0) {
      await pool.query(
        'UPDATE post_orders SET content = $1, updated_at = now(), updated_by = $2 WHERE site_id = $3',
        [content, req.user.id, req.site.id]
      );
    } else {
      await pool.query(
        'INSERT INTO post_orders (site_id, content, updated_by) VALUES ($1, $2, $3)',
        [req.site.id, content, req.user.id]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
