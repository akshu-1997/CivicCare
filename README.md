# CivicCare – Civic Issue Reporting System (project demonstration)

Not an official government service. Node.js + Express backend, PostgreSQL database, plain HTML/CSS/JS frontend, admin dashboard.

## What's included
- `server.js` – API, validation, admin auth, rate limiting
- `schema.sql` – tables (applied automatically on startup)
- `public/` – site (`index.html`, `app.js`, `style.css`) and admin dashboard (`admin.html`)
- `.env.example` – required environment variables

Privacy design: name and phone live in a separate table (`complaint_contacts`) and are returned only by admin endpoints. Photos are stored in the database (`complaint_photos`), checked by file signature, and served only to logged-in admins. Public endpoints never return contact data.

## Run locally
1. Install Node.js 18+ and PostgreSQL (or create a free Supabase project and use its connection string).
2. Create a database: `createdb civiccare`
3. `cp .env.example .env` and set `DATABASE_URL`, `ADMIN_PASSWORD`, `SESSION_SECRET`
   (generate a secret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
4. `npm install`
5. `npm start`, then open http://localhost:3000
6. Admin dashboard: http://localhost:3000/admin.html (log in with `ADMIN_PASSWORD`).

GPS works on `http://localhost` and on any HTTPS host.

## Deploy publicly (example: Supabase + Render)
1. **Database:** create a Supabase project. Copy the Postgres connection string (Project Settings → Database). Use the pooled/"Session" string if your host lacks IPv6.
2. **Code:** push this folder to a GitHub repository (`.env` is git-ignored).
3. **Host:** on Render (or Railway/Fly.io) create a *Web Service* from the repo. Build command `npm install`, start command `npm start`.
4. **Environment variables** on the host: `DATABASE_URL`, `DATABASE_SSL=true`, `ADMIN_PASSWORD`, `SESSION_SECRET`. (Do not set `PORT`; the host provides it.)
5. Open the HTTPS URL the host gives you. The tables are created on first start.

## Before going live
- Replace the placeholder contact details on the About page and the neighbourhood list at the top of `public/app.js`.
- Use a strong `ADMIN_PASSWORD`. This demo has a single shared admin login; add per-user accounts for real use.
- Photos are stored in Postgres (simple and shared across devices). For heavy traffic, move them to object storage such as Supabase Storage.
- Keep the "project demonstration" notice unless the service is officially authorised.

## API summary
| Method | Path | Access |
|---|---|---|
| POST | `/api/complaints` | public (multipart form) |
| GET | `/api/complaints/:id` | public (track) |
| GET | `/api/complaints/public` | public, filters `search`, `category`, `status` |
| GET | `/api/stats` | public |
| POST | `/api/admin/login` | returns an 8-hour token |
| GET | `/api/admin/complaints` | admin |
| PATCH | `/api/admin/complaints/:id/status` | admin |
| GET | `/api/admin/complaints/:id/photo` | admin |

## One-click Render setup
This repository includes `render.yaml` for a Render Blueprint deployment. Push the project to GitHub, choose **New → Blueprint** in Render, and select the repository. Render will create the web service and PostgreSQL database from the blueprint. When prompted, set a strong `ADMIN_PASSWORD`. Render generates `SESSION_SECRET` automatically. The app applies `schema.sql` at startup.

**Free-tier note:** Render's free web service may sleep when idle, and free PostgreSQL availability/retention is subject to Render's current plan limits. For a long-lived demonstration, use a persistent hosted PostgreSQL plan or a separate provider such as Neon/Supabase and set `DATABASE_URL` (and `DATABASE_SSL=true` if required) in the Render service environment.

Health check: `GET /api/health` checks both the application and database connection.
