# Web lane progress

## 2026-09-25 T21 Auth UI + shell
- Changed: `apps/web/` (auth pages, middleware, API client, Query provider, dashboard empty state, rewrite fix), root `README.md`
- Decisions:
  - Browser paths `/api/*` rewrite to Express `/:path*` (not `/api/:path*`) — because `docs/API.md` mounts `/auth/*` and `/health` at the API root; the previous scaffold destination double-prefixed `/api` and would 404.
  - Dashboard shows empty kits state without calling a kit list endpoint — because `docs/API.md` (T17a) has no kit CRUD routes yet ("Do not call kit/job routes until they appear here"). CTA links to `/kits/new` for T22a.
  - Middleware gates on `session` cookie presence only; JWT validity checked via `GET /auth/me` on the dashboard server render — because the web app does not hold `JWT_SECRET` and the contract puts auth enforcement on the API.
  - API client always uses `credentials: 'include'` and maps contract paths through `/api` — because same-origin cookies per project.mdc / API.md.
- Limitations / follow-ups: no `GET /kits` in contract → cannot list real kits until T17b/T18 extend API.md; `/kits/new` is CTA-only until T22a; desktop-focused layout.

## 2026-09-25 T22a Create kit form
- Changed: `apps/web/` (validation helpers + tests, `createKit` API client, `/kits/new` page + `CreateKitForm`), root `README.md`
- Decisions:
  - Thin-JD warning at 80 trimmed chars — because core `groundRequirements` uses the same `THIN_JD_CHARS` threshold for `notes.thin_jd`.
  - `createKit` treats HTTP `201` as new job and `200` as idempotent existing — because `docs/API.md` `POST /kits` documents that split; duplicate-submit notice only on `200`.
  - Form stays on `/kits/new` after success with a link to `/jobs/:id` — because T22b owns the job progress page; do not invent poll UI here.
  - Client validation mirrors API.md field rules (non-empty JD ≤100k, http(s) URL ≤2048, days integer 1–60) before `POST /kits`.
- Limitations / follow-ups: job timeline / batch upload are T22b; no kit list until a list route appears in API.md.
