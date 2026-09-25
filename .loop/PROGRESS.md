# PROGRESS — append-only log written by the loop (feeds the README)

## BLOCKED
(none)


## 2026-09-25 T01 Scaffold monorepo
- Changed: root package.json (workspaces + scripts), vitest.config.ts, tsconfig.base.json, .env.example, .gitignore, packages/core (index + evaluate CLI with process.loadEnvFile + smoke.test.ts), apps/api scaffold, apps/web (create-next-app App Router + Tailwind, next.config /api rewrite), scripts/serve-fixtures.ts stub
- Decisions: Next.js 15.2 via create-next-app with App Router + Tailwind + src/ — because SPEC prefers Next + Tailwind and T01 requires create-next-app; rewrite destination defaults to http://localhost:4000 via API_ORIGIN so cookies stay same-origin; fixtures/evaluate scripts wired early as stubs so root npm scripts work before T03/T16 fill them in
- Limitations / follow-ups: API is a console stub until T17a; fixtures server returns plain text until T03; evaluate CLI does not parse args until T16; Next 15.2.4 has a known advisory — bump when convenient

## 2026-09-25 T02 Kit schema + validator
- Changed: `packages/core/src/schema/` (kit.ts, batch.ts, validateKit.ts + test, index), core package.json (zod), `packages/core/src/index.ts` exports
- Decisions: `validateKit` returns `{ok, kit|issues}` with human-readable dotted/bracket paths rather than throwing — because callers (pipeline, CLI, API) need to surface every cross-ref failure at once; optional `research_log`/`notes`/per-item `meta` as `z.record` so later tasks can extend without loosening Appendix A required fields; difficulty as literal union {1,2,3} and minutes as `int().min(0)` in zod so schema violations share the same path format as cross-ref checks
- Limitations / follow-ups: status/kit/error consistency on Appendix B entries not enforced (schema allows any combination); uncovered_requirement_ids not cross-checked against role.requirements yet
