# PROGRESS — api lane

## BLOCKED
(none)

## Outside apps/api/ this iteration
- `README.md` (required in same commit)
- `docs/API.md` — added backward-compatible `GET /kits/:id` (T17b verify needs HTTP 404 scoping; auth routes unchanged)
- `package-lock.json` — npm install for `mongoose` + `mongodb-memory-server`
- `.loop/progress-api.md` (this log; TASKS.md not edited per lane rules)

## 2026-09-25 T17b Persistence models + kit scoping
- Changed: `apps/api/src/models/{User,Kit,Job,PracticeState}.ts`, `db/connect.ts`, `auth/mongooseStore.ts`, `kits/{store,routes}.ts`, `app.ts`, `index.ts`, `persistence.test.ts`; `apps/api/package.json` (+ mongoose, mongodb-memory-server); `docs/API.md`; `README.md`
- Decisions: all kit reads go through `findKitForUser(kitId, userId)` so foreign kits are indistinguishable from missing (404) — because §1 forbids reading others' kits; User/Kit/Job/PracticeState models store input + Appendix A kit + researchBundle + Leitner card boxes + job steps/status — because §13 requires enough to reopen/continue after restart; production `index.ts` requires `MONGODB_URI` and uses `createMongooseUserStore` while tests may still inject the in-memory store — because auth unit tests stay fast and T17a coverage remains; `mongodb-memory-server` as api devDependency — because T17b Verify mandates it (justified; not on the default allowlist alone)
- Limitations / follow-ups: no POST/list/job/practice routes yet (T18–T20); in-memory `UserStore` kept for injectable tests only; did not start T18; TASKS.md left unmarked
