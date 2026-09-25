# Web lane progress

## 2026-09-25 T21 Auth UI + shell
- Changed: `apps/web/` (auth pages, middleware, API client, Query provider, dashboard empty state, rewrite fix), root `README.md`
- Decisions:
  - Browser paths `/api/*` rewrite to Express `/:path*` (not `/api/:path*`) — because `docs/API.md` mounts `/auth/*` and `/health` at the API root; the previous scaffold destination double-prefixed `/api` and would 404.
  - Dashboard shows empty kits state without calling a kit list endpoint — because `docs/API.md` (T17a) has no kit CRUD routes yet ("Do not call kit/job routes until they appear here"). CTA links to `/kits/new` for T22a.
  - Middleware gates on `session` cookie presence only; JWT validity checked via `GET /auth/me` on the dashboard server render — because the web app does not hold `JWT_SECRET` and the contract puts auth enforcement on the API.
  - API client always uses `credentials: 'include'` and maps contract paths through `/api` — because same-origin cookies per project.mdc / API.md.
- Limitations / follow-ups: no `GET /kits` in contract → cannot list real kits until T17b/T18 extend API.md; `/kits/new` is CTA-only until T22a; desktop-focused layout.
