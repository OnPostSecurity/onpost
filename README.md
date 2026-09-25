# OnPost

A web app for security guard companies: officers clock in/out, log photographic
checkpoints, read their daily shift briefing, and file reports — while
supervisors and masters run the operation. Mobile-first, so it works well on
guards' phones.

**Roles**
- **Master** — full control: sites, post orders, checkpoint locations, team, everything.
- **Supervisor** — everything except editing post orders and checkpoint locations.
- **Officer** — clock in/out, log photo checkpoints, file reports; reads briefings,
  post orders, and locations read-only. New accounts start as unassigned Officers
  until a Master/Supervisor assigns them to sites.

**Key behaviors**
- **Post orders** are standing instructions per site — they carry over day to day
  automatically and only change when a Master edits them.
- **Checkpoint locations** are standing per-site data too. A Master can manage the
  list; when a Master types a new location while logging a checkpoint it is saved
  automatically. Other roles' ad-hoc names are stored on the checkpoint only.
- **Daily briefings** hold the date-specific part (priorities, handoff notes);
  post orders are always shown live from the standing record.

## Quick start (easiest)

Requires [Docker](https://www.docker.com/) — one command:

```bash
docker compose up --build
```

Open http://localhost:3000. The database is created automatically and the schema
is migrated on every boot.

To load demo data (a demo Master account + a sample site):

```bash
docker compose exec app npm run seed
```

Then sign in with `master@example.com` / `Master123!` — **change the password
immediately** (top-right → Password) and delete the demo accounts before real use.

To stop: `docker compose down` (add `-v` to wipe the database too).

## Manual start (without Docker)

Requires Node.js 18+ and a PostgreSQL database.

```bash
cp .env.example .env        # then edit DATABASE_URL and JWT_SECRET
npm install
npm run migrate            # or just start the server — migrations run on boot
npm run seed               # optional demo data
npm start
```

## Environment variables

| Variable | Required | Default | What it does |
|---|---|---|---|
| `DATABASE_URL` | yes | — | Postgres connection string |
| `PGSSLMODE` | on hosted DBs | — | Set to `require` when the host enforces TLS (e.g. Render) |
| `JWT_SECRET` | yes (prod) | — | Long random string used to sign login tokens. Generate: `openssl rand -base64 32` |
| `PORT` | no | `3000` | HTTP port |
| `NODE_ENV` | no | `development` | Set to `production` when deployed |
| `ALLOW_REGISTRATION` | no | `true` | `false` closes self-registration |
| `UPLOAD_DIR` | no | `./uploads` | Where checkpoint photos are stored |

## Project layout

```
migrations/        SQL schema migrations (applied automatically on boot, in order)
scripts/seed.js    Demo seed: demo Master/Officer accounts + sample site (clearly marked)
src/
  server.js        Entry point: waits for DB, migrates, listens
  app.js           Express app factory (also used by tests)
  db.js            Postgres pool
  migrate.js       Migration runner
  auth.js          Login cookies, requireAuth, requireRole, per-site access, CSRF check
  routes/          API endpoints (auth, sites, users, shifts, checkpoints,
                   post-orders, briefings, reports) — every route enforces roles
                   on the server; the client is never trusted
public/            Single-page frontend (no framework): index.html, app.js, styles.css
tests/api.test.js  28 API tests, run against in-memory Postgres (pg-mem)
uploads/           Checkpoint photos (git-ignored)
```

## Photo storage (v1)

Checkpoint photos are stored on local disk under `UPLOAD_DIR` with unguessable
UUID filenames. This is fine for v1 and single-server deploys, but files are
**ephemeral on most free hosting tiers** (they vanish on redeploy) and won't be
shared if you ever run multiple servers.

**When you're ready to grow:** move uploads to S3-compatible object storage
(AWS S3, Cloudflare R2, Backblaze B2). The change is small and isolated: swap the
multer disk storage in `src/routes/checkpoints.js` for an S3 upload, store the
object key in `photo_path`, and serve via signed URLs or a CDN. The database
schema already stores only the path/key, so no migration is needed.

## Tests

```bash
npm test
```

Runs the full API suite against an in-memory Postgres — no database or Docker needed.

## Security notes

- Passwords are hashed with bcrypt (cost 12). Login state is a signed JWT in an
  `HttpOnly`, `SameSite=lax` cookie (never in localStorage).
- Every endpoint re-checks the user's role and site assignment on the server.
- Mutating requests are blocked when the `Origin`/`Referer` doesn't match the host.
- Never commit a real `.env` file or a production `JWT_SECRET`.
