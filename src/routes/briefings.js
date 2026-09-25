import { Router } from 'express';
import { getPool } from '../db.js';
import { requireRole, siteAccess } from '../auth.js';

const router = Router({ mergeParams: true });
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// GET /api/sites/:siteId/briefing?date=YYYY-MM-DD
// Returns the date-specific briefing plus the live post orders (carried over).
router.get('/', siteAccess, async (req, res, next) => {
  try {
    const date = DATE_RE.test(req.query.date || '') ? req.query.date : todayISO();
    const pool = getPool();
    const [{ rows: b }, { rows: po }] = await Promise.all([
      pool.query('SELECT priorities, handoff_notes, updated_at FROM briefings WHERE site_id = $1 AND date = $2', [
        req.site.id,
        date,
      ]),
      pool.query('SELECT content FROM post_orders WHERE site_id = $1', [req.site.id]),
    ]);
    res.json({
      site_id: req.site.id,
      date,
      priorities: b[0]?.priorities ?? '',
      handoff_notes: b[0]?.handoff_notes ?? '',
      updated_at: b[0]?.updated_at ?? null,
      // Standing instructions — read from the live row so they always carry over.
      post_orders: po[0]?.content ?? '',
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/sites/:siteId/briefing — master / supervisor only (officers read).
router.put('/', requireRole('master', 'supervisor'), siteAccess, async (req, res, next) => {
  try {
    const { date, priorities = '', handoff_notes = '' } = req.body ?? {};
    if (!DATE_RE.test(date || '')) {
      return res.status(400).json({ error: 'A valid date (YYYY-MM-DD) is required.' });
    }
    const pool = getPool();
    const existing = await pool.query(
      'SELECT 1 FROM briefings WHERE site_id = $1 AND date = $2',
      [req.site.id, date]
    );
    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE briefings SET priorities = $1, handoff_notes = $2, updated_at = now(), updated_by = $3
         WHERE site_id = $4 AND date = $5`,
        [priorities, handoff_notes, req.user.id, req.site.id, date]
      );
    } else {
      await pool.query(
        `INSERT INTO briefings (site_id, date, priorities, handoff_notes, updated_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.site.id, date, priorities, handoff_notes, req.user.id]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
