# PROGRESS — api lane

## BLOCKED
(none)

## Outside apps/api/ this iteration
- `README.md` (required in same commit)
- `docs/API.md` — job lifecycle + `POST /kits`, `POST /kits/batch`, `GET /jobs/:id`, `POST /jobs/:id/retry` (SPEC-required for web; no invented routes)
- `.loop/progress-api.md` (this log; TASKS.md not edited per lane rules)

## 2026-09-25 T18 Generation jobs
- Changed: `apps/api/src/jobs/{idempotency,schema,store,service,worker,routes}.ts`, `jobs.test.ts`, `kits/routes.ts`, `app.ts`, `index.ts`; `docs/API.md`; `README.md`
- Decisions: idempotency key = sha256(userId + collapsed-whitespace JD + canonical URL + days) with unique `(userId, idempotencyKey)` — because §10 same JD+company must not spawn a second pipeline; in-process `JobWorker` persists step upserts and runs injectable `runPipeline` — because long ~90 s runs must be poll-friendly without a separate queue product; boot marks `running` → `failed`/`INTERRUPTED` and re-enqueues leftover `queued` — because §13 reopen/continue after restart; `validateKit` again before `Kit` insert — because task requires structure check before save even though the pipeline already validates; failed jobs returned as-is on `POST /kits` (explicit `POST /jobs/:id/retry`) — because unique key forbids a second row and retry must be intentional for mid-fail
- Limitations / follow-ups: `researchBundle` not yet stored on Kit (pipeline still returns kit only; T19b regenerate); no `GET /kits` list (not in T18); did not start T19b/T20; TASKS.md left unmarked; `docs/SPEC.md` missing from this worktree — followed TASKS + cited §10/§13 behaviours

## 2026-09-25 T17b Persistence models + kit scoping
- Changed: `apps/api/src/models/{User,Kit,Job,PracticeState}.ts`, `db/connect.ts`, `auth/mongooseStore.ts`, `kits/{store,routes}.ts`, `app.ts`, `index.ts`, `persistence.test.ts`; `apps/api/package.json` (+ mongoose, mongodb-memory-server); `docs/API.md`; `README.md`
- Decisions: all kit reads go through `findKitForUser(kitId, userId)` so foreign kits are indistinguishable from missing (404) — because §1 forbids reading others' kits; User/Kit/Job/PracticeState models store input + Appendix A kit + researchBundle + Leitner card boxes + job steps/status — because §13 requires enough to reopen and continue after restart; production `index.ts` requires `MONGODB_URI` and uses `createMongooseUserStore` while tests may still inject the in-memory store — because auth unit tests stay fast and T17a coverage remains; `mongodb-memory-server` as api devDependency — because T17b Verify mandates it (justified; not on the default allowlist alone)
- Limitations / follow-ups: no POST/list/job/practice routes yet (T18–T20); in-memory `UserStore` kept for injectable tests only; did not start T18; TASKS.md left unmarked
