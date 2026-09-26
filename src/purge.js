import fs from 'node:fs';
import path from 'node:path';

export const PHOTO_RETENTION_DAYS = 30;

/**
 * Deletes checkpoint photo *files* older than PHOTO_RETENTION_DAYS and clears
 * their photo_path. The checkpoint records themselves are kept forever as the
 * audit trail — only the image files cycle. If a photo matters, download it
 * before it expires.
 *
 * Runs on server boot, so it executes on every deploy/restart. Safe to run
 * repeatedly: already-cleared rows are skipped.
 */
export async function purgeOldPhotos(pool, uploadDir, retentionDays = PHOTO_RETENTION_DAYS) {
  const dir = path.resolve(uploadDir || process.env.UPLOAD_DIR || './uploads');
  const cutoff = Date.now() - retentionDays * 86400000;
  // Date filtering happens in JS (not SQL) so behavior is identical on
  // pg-mem and real Postgres.
  const { rows } = await pool.query(
    'SELECT id, photo_path, created_at FROM checkpoints WHERE photo_path IS NOT NULL'
  );
  const expired = rows.filter((r) => new Date(r.created_at).getTime() < cutoff);
  for (const r of expired) {
    try {
      await fs.promises.unlink(path.join(dir, path.basename(r.photo_path)));
    } catch {
      // already gone — just clear the reference
    }
    await pool.query('UPDATE checkpoints SET photo_path = NULL WHERE id = $1', [r.id]);
  }
  if (expired.length > 0) {
    console.log(`[purge] expired ${expired.length} checkpoint photo(s) older than ${retentionDays} days`);
  }
  return expired.length;
}
