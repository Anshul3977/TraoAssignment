# Checkpoint C — API walk + mergeRegenerated audit

Date: 2026-09-25  
HEAD at start: `3a8df1f` (api+web merged). This file written after the curl walk and code audit.

## T17–T20 on main

**Yes.** `git log --oneline -20` on `main` includes:

| Task | Commit |
|---|---|
| T17a | `c0051a8` feat(api): Express auth base, health, and docs/API.md |
| T17b | `856cae5` feat(api): Mongoose models and userId-scoped kit reads |
| T18 | `7b7bcb2` feat(api): async generation jobs with idempotency |
| T19a | `407201d` feat(core): merge regenerated kit sections without clobbering edits |
| T19b | `6ae1224` feat(api): PATCH kit ops and section regenerate |
| T20 | `36c9965` feat(api): Leitner practice review, next, and stats |

T18 was already on main; did not wait for it.

## Checkpoint B kits (not re-run)

Quoted from `.loop/checkpoint-b.md` and verified `out/kits-run1.json` / `out/kits.json` still have **5× `status: ok`**. Fixture judgment table all **PASS**. Timed run1 was **506.3 s** (~8.4 min). **Did not re-run** the 8-minute batch.

## How the live API was started

Local `mongodb://127.0.0.1:27017` was not listening. README requires `MONGODB_URI` + `JWT_SECRET`. Started Express via `apps/api` `src/index.ts` against **mongodb-memory-server**, with `ALLOW_PRIVATE_HOSTS=true` and env from gitignored `.env` (GEMINI set; key not printed). Fixtures already on `:8099`. Base URL: **`http://localhost:4000`** (no `/api` prefix). Cookie name: **`session`**.

## Curl walk (PowerShell / curl.exe)

Live generation finished in **under 4 minutes** (~70 s poll). Job step timeline:

`extract=done` → `crawl=done` → `search_discussion=skipped` → `brief=done` → `interview_process=done` → `questions=skipped` → `coverage=done` → `flashcards=done` → `schedule=done` → `validate=done`

(`questions=skipped` because `generateQuestions:system-design` logged invalid JSON after repair; coverage still produced technical + behavioural questions.)

| Step | Method / path | Status | Notes |
|---|---|---|---|
| Register | `POST /auth/register` | **201** | Sets `session` |
| Login | `POST /auth/login` | **200** | Same cookie |
| Me | `GET /auth/me` | **200** | Current user |
| Create job | `POST /kits` | **201** | job `6ab661462b8712896a93d066` |
| Idempotent retry | `POST /kits` same body | **200** | **Same job id** |
| Poll | `GET /jobs/:id` | **200** until `done` | `kitId=6ab661872b8712896a93d067` |
| Get kit | `GET /kits/:id` | **200** | `version=1`; technical **q1**; behavioural **q3**; no system-design / company-fit items on this kit |
| Edit | `PATCH /kits/:id` `prompt=MY EDIT` + `baseVersion` | **200** | |
| Regen technical | `POST /kits/:id/regenerate` `{section:questions,category:technical}` | **200** | |
| Get kit after regen | `GET /kits/:id` | **200** | **MY EDIT count = 1** (q1 kept) |
| Stale version 0 | `PATCH` `baseVersion: 0` | **400** `VALIDATION_ERROR` | Schema is `z.number().int().min(1)` (`opsSchema.ts`); 0 never reaches the version check |
| Stale version 1 | `PATCH` `baseVersion: 1` after version is 3 | **409** `VERSION_CONFLICT` | Current kit in body (`version: 3`); MY EDIT still on q1 |
| Other user | `GET` first user’s kit | **404** | |
| No cookie | `GET /auth/me` | **401** `UNAUTHENTICATED` | |

## mergeRegenerated answers (from code)

Source: `packages/core/src/deterministic/mergeRegenerated.ts` (+ API `regenerate.ts` / `opsSchema.ts` for Q8). **No production gaps.** Two unit tests added to lock Q4/Q5 (moved category + un-normalised dismissed).

### 1. Protected items; fallback

`isProtectedItem`: **`origin === "user"` OR `edited === true` OR `pinned === true`**.

Untouched **generated** and **fallback** items in the regenerated category are **dropped**. After merge, `appendFallbackForCategory` re-runs `findGaps` and appends **new** `origin: "fallback"` questions only for remaining **must** gaps whose `kind` maps to that category (`technical`/`domain` → technical, `behavioural` → behavioural). Nice gaps may stay uncovered.

### 2. Placement of new generated items

Walk original `questions` in order: keep other-category items and protected items **in that relative order**. New candidates (then fallbacks) are **appended after** the kept list. Vacated generated slots are not filled in-place.

### 3. Ids / `next_ids`

Candidate ids are ignored. Fresh ids from `max(meta.next_ids.question, max existing qN + 1)`, then counter advances. Deleted ids are not reused while `next_ids` stays ahead of the highest ever assigned (kits persist `meta.next_ids`). After merge, `withNextIds` writes the counter back.

### 4. Dismissed / deleted prompts

**Normalised**, not exact: `trim` + lowercase + collapse whitespace (`normalisePrompt`). Stored `meta.dismissed` entries are normalised again when building the set. Incoming prompts matching that set are skipped (no resurrect).

### 5. Moved technical → behavioural, then regen technical

**Stays put.** Merge only replaces items with `q.category ===` the regen category. A moved question is treated as another category even if still `origin: generated` and unedited/unpinned.

### 6. Coverage

**Recomputed.** After merge + fallbacks, `coverage.uncovered_requirement_ids` is set from `findGaps`. If the only covering question for a **must** in that category is unprotected and removed, a fallback is added unless new candidates already cover it. Musts in other categories are not fallback-filled by this regen.

### 7. Schedule

If `questionsChanged`, `applyScheduleAfterQuestionChange` runs. The API always passes `reallocateSchedule` wrapping **`allocateSchedule`** (`apps/api/src/kits/regenerate.ts`), so the schedule is fully rebuilt from the post-merge question bank (replaced scheduled ids get new allocations). Without the hook (unit tests), stale ids are **pruned** only.

Live walk after technical regen: day 1 `question_ids` included kept **q1** (MY EDIT) plus new **q4, q5, q6** and behavioural **q3**.

### 8. Version / concurrency

**PATCH 409** when `baseVersion` is an integer ≥ 1 but ≠ current `kit.version` (`VERSION_CONFLICT` + current kit). `baseVersion: 0` is **400** validation, not 409. Confirmed live: 0 → 400; 1 vs current 3 → 409.

## Creative feature

**KEEP Story Bank** (do not replace with Replan). T26 not started in this checkpoint.

Reasons: original idea; reusable STAR stories mapped once; deterministic keyword overlap onto requirement ids; easy to demo (“no story for mentoring juniors”).

## Gaps fixed

None in production merge/API behaviour. Tests only: moved-out-of-category survival; dismissed matching after normalisation of raw list entries.

## Checkpoint C

Ticked `[x]` in `.loop/TASKS.md` after this walk + audit.
