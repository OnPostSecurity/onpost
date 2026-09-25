import jwt from 'jsonwebtoken';
import { getPool } from './db.js';

const COOKIE_NAME = 'gsm_token';
const TOKEN_TTL_SECONDS = 12 * 60 * 60; // 12 hours

export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret && secret !== 'change-me-to-a-long-random-string') return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set to a strong random value in production.');
  }
  console.warn('[auth] WARNING: using insecure development JWT secret. Set JWT_SECRET.');
  return 'dev-secret-change-me';
}

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, getJwtSecret(), {
    expiresIn: TOKEN_TTL_SECONDS,
  });
}

export function setAuthCookie(res, user) {
  res.cookie(COOKIE_NAME, signToken(user), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: TOKEN_TTL_SECONDS * 1000,
    path: '/',
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

/**
 * requireAuth: verifies the login cookie and loads the fresh user row
 * (so role changes take effect immediately). Never trust the client:
 * every protected route goes through this.
 */
export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) return res.status(401).json({ error: 'Not signed in.' });
    const payload = jwt.verify(token, getJwtSecret());
    const pool = getPool();
    const { rows } = await pool.query(
      'SELECT id, name, email, role, created_at FROM users WHERE id = $1',
      [payload.sub]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Account no longer exists.' });
    }
    req.user = rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }
}

/** requireRole('master'), requireRole('master','supervisor'), ... */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission for this action.' });
    }
    next();
  };
}

/**
 * siteAccess: loads the site and enforces per-site visibility.
 * Masters and supervisors see every site; officers only see sites
 * they are assigned to (via user_sites).
 * Attaches req.site. Responds 404 for unknown/archived-hidden sites so
 * officers can't probe for site IDs.
 */
export async function siteAccess(req, res, next) {
  try {
    const pool = getPool();
    const siteId = req.params.siteId ?? req.params.id;
    const { rows } = await pool.query('SELECT * FROM sites WHERE id = $1', [siteId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Site not found.' });
    const site = rows[0];

    if (req.user.role === 'officer') {
      if (site.archived) return res.status(404).json({ error: 'Site not found.' });
      const assigned = await pool.query(
        'SELECT 1 FROM user_sites WHERE user_id = $1 AND site_id = $2',
        [req.user.id, siteId]
      );
      if (assigned.rows.length === 0) {
        return res.status(403).json({ error: 'You are not assigned to this site.' });
      }
    }
    req.site = site;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * sameOrigin: lightweight CSRF mitigation for cookie auth. Browsers only
 * send Origin/Referer on cross-site requests; if one is present it must
 * match this host. Combined with SameSite=lax cookies.
 */
export function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin || req.headers.referer;
  if (origin) {
    try {
      const host = new URL(origin).host;
      if (host !== req.headers.host) {
        return res.status(403).json({ error: 'Cross-site request blocked.' });
      }
    } catch {
      return res.status(403).json({ error: 'Cross-site request blocked.' });
    }
  }
  next();
}
