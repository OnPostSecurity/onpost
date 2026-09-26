import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { getPool } from '../db.js';
import { requireRole, siteAccess } from '../auth.js';

// Mounted at /api/sites/:siteId — handles both /locations and /checkpoints.
const router = Router({ mergeParams: true });

// Upload storage is resolved lazily (per request) so tests and the app
// factory can point UPLOAD_DIR at a temp directory.
let _upload = null;
let _uploadDir = null;
function getUpload() {
  const dir = path.resolve(process.env.UPLOAD_DIR || './uploads');
  if (!_upload || _uploadDir !== dir) {
    fs.mkdirSync(dir, { recursive: true });
    _uploadDir = dir;
    const storage = multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, dir),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase().slice(0, 10) || '.jpg';
        cb(null, `${randomUUID()}${ext}`);
      },
    });
    _upload = multer({
      storage,
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
      fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Only image files are allowed.'));
      },
    });
  }
  return _upload;
}

// ---- Photo timestamp stamp --------------------------------------------------
// Burns a timestamp bar (location, date/time, officer) into the image itself so
// the proof travels with the file, not just the database record. Best-effort:
// if stamping fails the checkpoint still goes through unstamped.
function escXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

async function stampPhoto(filePath, { locationName, officerName, timeZone }) {
  const meta = await sharp(filePath).metadata();
  const w = meta.width || 800;
  const barH = Math.max(30, Math.round(w * 0.08));
  const fontSize = Math.round(barH * 0.42);
  const when = new Intl.DateTimeFormat('en-US', {
    timeZone, month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date());
  const line = `${locationName}   •   ${when}   •   ${officerName}`;
  const svg =
    `<svg width="${w}" height="${barH}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="100%" height="100%" fill="black" fill-opacity="0.62"/>` +
    `<text x="10" y="${Math.round(barH / 2 + fontSize * 0.35)}" font-family="sans-serif" font-size="${fontSize}" fill="white">${escXml(line)}</text></svg>`;
  const tmp = `${filePath}.tmp${path.extname(filePath) || '.jpg'}`;
  await sharp(filePath).rotate().composite([{ input: Buffer.from(svg), gravity: 'south' }]).toFile(tmp);
  fs.renameSync(tmp, filePath);
}

function validTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'America/Denver';
  }
}

// ---- Standing checkpoint locations -----------------------------------------

// GET /api/sites/:siteId/locations
router.get('/locations', siteAccess, async (req, res, next) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      'SELECT id, name, created_at FROM checkpoint_locations WHERE site_id = $1 ORDER BY name',
      [req.site.id]
    );
    res.json({ locations: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/sites/:siteId/locations — MASTER ONLY (supervisors cannot edit locations)
router.post('/locations', requireRole('master'), siteAccess, async (req, res, next) => {
  try {
    const { name } = req.body ?? {};
    if (!name?.trim()) return res.status(400).json({ error: 'Location name is required.' });
    const pool = getPool();
    const existing = await pool.query(
      'SELECT id, name, created_at FROM checkpoint_locations WHERE site_id = $1 AND name = $2',
      [req.site.id, name.trim()]
    );
    if (existing.rows.length > 0) return res.status(200).json({ location: existing.rows[0] });
    const { rows } = await pool.query(
      'INSERT INTO checkpoint_locations (id, site_id, name) VALUES ($1, $2, $3) RETURNING id, name, created_at',
      [randomUUID(), req.site.id, name.trim()]
    );
    res.status(201).json({ location: rows[0] });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/sites/:siteId/locations/:locationId — MASTER ONLY
router.delete('/locations/:locationId', requireRole('master'), siteAccess, async (req, res, next) => {
  try {
    const pool = getPool();
    const { rowCount } = await pool.query(
      'DELETE FROM checkpoint_locations WHERE id = $1 AND site_id = $2',
      [req.params.locationId, req.site.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Location not found.' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---- Checkpoint log entries -------------------------------------------------

// GET /api/sites/:siteId/checkpoints?date=YYYY-MM-DD
router.get('/checkpoints', siteAccess, async (req, res, next) => {
  try {
    const pool = getPool();
    const clauses = ['c.site_id = $1'];
    const params = [req.site.id];
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '')) {
      params.push(req.query.date);
      clauses.push(`c.created_at::date = $${params.length}::date`);
    }
    const { rows } = await pool.query(
      `SELECT c.*, u.name AS user_name
       FROM checkpoints c LEFT JOIN users u ON u.id = c.user_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY c.created_at DESC LIMIT 200`,
      params
    );
    res.json({
      checkpoints: rows.map((c) => ({
        ...c,
        photo_url: c.photo_path ? `/uploads/${path.basename(c.photo_path)}` : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/sites/:siteId/checkpoints/:id — Master only. Removes the record and its photo.
router.delete('/checkpoints/:id', requireRole('master'), siteAccess, async (req, res, next) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      'SELECT id, photo_path FROM checkpoints WHERE id = $1 AND site_id = $2',
      [req.params.id, req.site.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Checkpoint not found.' });
    if (rows[0].photo_path) {
      fs.unlink(path.join(path.resolve(process.env.UPLOAD_DIR || './uploads'), rows[0].photo_path), () => {});
    }
    await pool.query('DELETE FROM checkpoints WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/sites/:siteId/checkpoints — multipart: photo (required),
// location_id OR new_location, note (optional).
router.post('/checkpoints', siteAccess, (req, res, next) => {
  getUpload().single('photo')(req, res, (err) => {
    if (err) return next(err);
    handleCheckpointPost(req, res, next);
  });
});

async function handleCheckpointPost(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'A photo is required for a checkpoint.' });
    const { location_id, new_location, note = '' } = req.body ?? {};
    const pool = getPool();

    let locationId = null;
    let locationName = '';

    if (location_id) {
      const { rows } = await pool.query(
        'SELECT id, name FROM checkpoint_locations WHERE id = $1 AND site_id = $2',
        [location_id, req.site.id]
      );
      if (rows.length === 0) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: 'Unknown checkpoint location.' });
      }
      locationId = rows[0].id;
      locationName = rows[0].name;
    } else if (new_location?.trim()) {
      locationName = new_location.trim();
      if (req.user.role === 'master') {
        // Masters: a newly typed location becomes a standing location automatically.
        const { rows } = await pool.query(
          'SELECT id FROM checkpoint_locations WHERE site_id = $1 AND name = $2',
          [req.site.id, locationName]
        );
        locationId =
          rows[0]?.id ??
          (
            await pool.query(
              'INSERT INTO checkpoint_locations (id, site_id, name) VALUES ($1, $2, $3) RETURNING id',
              [randomUUID(), req.site.id, locationName]
            )
          ).rows[0].id;
      }
      // Non-masters: the ad-hoc name is stored on the checkpoint only;
      // standing locations stay master-managed.
    } else {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Pick a checkpoint location or type a new one.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO checkpoints (id, site_id, location_id, location_name, photo_path, note, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, site_id, location_id, location_name, note, user_id, created_at`,
      [randomUUID(), req.site.id, locationId, locationName, req.file.filename, note.trim(), req.user.id]
    );
    try {
      await stampPhoto(req.file.path, {
        locationName,
        officerName: req.user.name,
        timeZone: validTimeZone(req.body?.tz),
      });
    } catch (err) {
      console.error('photo timestamp stamp failed:', err.message);
    }
    res.status(201).json({
      checkpoint: { ...rows[0], photo_url: `/uploads/${req.file.filename}` },
    });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    next(err);
  }
}

export default router;
