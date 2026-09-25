# Deploying OnPost to Render

This guide takes the app from the code on your computer to a live website with
an address you can share — for example `https://onpost.onrender.com`.
No technical background assumed. It takes about 30–45 minutes the first time.

You will create three free things: a **GitHub** account (holds the code),
a **Render** account (runs the app), and a **PostgreSQL database** on Render
(stores everything).

---

## Part 1 — Put the code on GitHub

Render deploys directly from GitHub, so the code needs to live there first.

1. Go to https://github.com and create an account (if you don't have one).
2. Click the **+** in the top-right → **New repository**.
   - Name it `onpost`.
   - Leave it **Public** (private works too, but public is simpler on the free tier).
   - Do **not** check "Add a README".
   - Click **Create repository**.
3. GitHub shows you a page with commands. On your computer, open a terminal in
   the project folder and run the commands GitHub shows under
   "…or push an existing repository from the command line". They look like this
   (replace `YOUR-USERNAME` with your GitHub username):

```bash
git init
git add .
git commit -m "OnPost v1"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/onpost.git
git push -u origin main
```

   If it asks you to sign in, use your GitHub username and a
   **personal access token** as the password (GitHub → Settings → Developer
   settings → Personal access tokens → Generate new token).

4. Refresh the GitHub page — you should now see the project files there.

> Later, whenever you change the code, run `git add .`, `git commit -m "describe
> the change"`, `git push` and Render will redeploy automatically.

---

## Part 2 — Create the database on Render

1. Go to https://render.com and sign up (the GitHub button is easiest — it links
   your accounts).
2. In the Render dashboard click **New +** → **PostgreSQL**.
   - Name: `onpost-db`
   - Database: `guardshift`
   - User: leave as-is
   - Region: pick the one closest to you (e.g. Oregon)
   - Plan: **Free**
   - Click **Create Database**.
3. Wait a minute for it to become **Available**. Open it and copy the
   **Internal Database URL** (starts with `postgres://…`). You'll paste this in
   Part 3 — keep it handy.

---

## Part 3 — Deploy the app on Render

1. In the Render dashboard click **New +** → **Web Service**.
2. Choose **Build and deploy from a Git repository** → connect your
   `onpost` repo → **Connect**.
3. Fill in the settings:
   - **Name:** `onpost`
   - **Region:** same as your database
   - **Branch:** `main`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free
4. Open the **Environment Variables** section and add these (click **Add** for each):

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | Paste the **Internal Database URL** from Part 2 |
   | `PGSSLMODE` | `require` |
   | `JWT_SECRET` | A long random string — click **Generate** next to the value field, or run `openssl rand -base64 32` in a terminal and paste the output |
   | `NODE_ENV` | `production` |
   | `ALLOW_REGISTRATION` | `true` |
   | `UPLOAD_DIR` | `/opt/render/project/src/uploads` |

   > ⚠️ `JWT_SECRET` is the key that signs logins. Never share it, and never
   > reuse the example from `.env.example`.

5. Click **Create Web Service**. Render will build and start the app — this takes
   a few minutes. Watch the **Logs** tab; you should see:

```
[migrate] applied 001_init.sql
OnPost listening on http://localhost:10000
```

   (The port number in the log doesn't matter — Render handles the public address.)

6. When the status shows **Live**, click the URL at the top (something like
   `https://onpost.onrender.com`). The sign-in page should appear.

---

## Part 4 — Create your accounts

No terminal needed. The app bootstraps itself: **the very first account
registered on a fresh database automatically becomes Master**. (Render's free
plan doesn't include the Shell tab, so the `npm run seed` demo accounts are
only usable from your own machine — skip them for production.)

1. Open your live URL and click **Create an officer account**.
2. Register with your real name and email. You land as **Master** automatically.
3. Everyone who registers after that becomes an Officer — you promote them from
   the site's **Team** tab.

---

## Things to know about the free tier

- **The app sleeps when idle.** The first visit after a while takes ~30–60 seconds
  to wake up. Paid plans ($7+/month) stay awake.
- **Uploaded photos are temporary.** On the free tier, checkpoint photos disappear
  when Render redeploys or restarts the app. For a real business, attach a
  **Render Disk** (paid) or move uploads to S3-style storage — see "Photo
  storage" in the README; it's a small, isolated change.
- **The database is free up to 1 GB**, which is plenty to start.
- **Custom domain:** in the web service → **Settings** → **Custom Domain** you can
  point your own domain (e.g. `app.yourcompany.com`) at the app.

## If something goes wrong

- **Build fails:** check the Logs tab — usually a typo in the build/start command.
  They must be exactly `npm install` and `npm start`.
- **"DATABASE_URL is not set"** in logs: the environment variable is missing or
  misspelled — re-check Part 3, step 4.
- **Database connection errors:** make sure `PGSSLMODE` is set to `require` and
  that you pasted the **Internal** (not External) Database URL.
- **App is live but pages won't load:** give it a minute — the first boot runs
  the database migrations.

When you're ready to sell this to guard companies, the next upgrades are:
a persistent disk or S3 for photos (see README), a custom domain, and turning
`ALLOW_REGISTRATION` to `false` once you've created the accounts you need.
