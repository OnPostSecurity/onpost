import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setPool } from './db.js';
import { requireAuth, sameOrigin } from './auth.js';
import authRoutes from './routes/auth.js';
import sitesRoutes from './routes/sites.js';
import usersRoutes from './routes/users.js';
import shiftsRoutes from './routes/shifts.js';
import checkpointsRoutes from './routes/checkpoints.js';
import postOrdersRoutes from './routes/postOrders.js';
import briefingsRoutes from './routes/briefings.js';
import reportsRoutes from './routes/reports.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

/**
 * Builds the Express app. Accepts an injected pool + uploadDir so tests
 * can run the full API against an in-memory database.
 */
export function createApp({ pool = null, uploadDir = null } = {}) {
  if (pool) setPool(pool);
  if (uploadDir) process.env.UPLOAD_DIR = uploadDir;

  const app = express();
  app.disable('x-powered-by');
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(sameOrigin);

  // Checkpoint photos (filenames are unguessable UUIDs; see README).
  const uploads = path.resolve(process.env.UPLOAD_DIR || './uploads');
  fs.mkdirSync(uploads, { recursive: true });
  app.use('/uploads', express.static(uploads, { maxAge: '7d', immutable: true }));

  // Public API
  app.use('/api/auth', authRoutes);

  // Everything below requires a signed-in user; each route enforces roles.
  app.use('/api/sites', requireAuth, sitesRoutes);
  app.use('/api/sites/:siteId/post-orders', requireAuth, postOrdersRoutes);
  app.use('/api/sites/:siteId/briefing', requireAuth, briefingsRoutes);
  app.use('/api/sites/:siteId', requireAuth, checkpointsRoutes); // /locations + /checkpoints
  app.use('/api/sites/:siteId/reports', requireAuth, reportsRoutes);
  app.use('/api/shifts', requireAuth, shiftsRoutes);
  app.use('/api/users', requireAuth, usersRoutes);

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  // Frontend (single-page app)
  app.use(express.static(PUBLIC_DIR));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  // JSON error handler (multer errors, etc.)
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error('[api]', err.message);
    const status = err.status || 400;
    res.status(status).json({ error: err.message || 'Something went wrong.' });
  });

  return app;
}
