# Prep Kit

Interview prep kit generator (Trao FS-AI-INTERVIEW-01). Paste a job description and company URL; the pipeline researches the company and builds a kit (brief, requirements, questions, flashcards, schedule).

## Layout

npm workspaces:

- `packages/core` — schema, retrieval, LLM helpers, deterministic steps, pipeline pieces
- `apps/api` — Express API (auth, Mongo persistence, scoped kits, async generation jobs — see `docs/API.md`)
- `apps/web` — Next.js App Router UI (auth shell, dashboard, create-kit / batch upload, job progress, kit builder, Story Bank, practice, schedule + coverage matrix)
- `docs/API.md` — HTTP contract the web app builds against

## Setup

```bash
npm install
```

Requires Node ≥ 20. Copy `.env.example` to `.env` and fill values as needed. Do not commit secrets. Default Gemini model is `gemini-flash-lite-latest` (free-tier daily request caps are per-model; set `GEMINI_MODEL` to override).

## Commands

```bash
npm run typecheck
npm test
npm run fixtures                                          # serves fixtures/sites on :8099
npm run evaluate -- --input fixtures/cases.json --output out/kits.json
npm run check-output -- --input out/kits.json             # validate Appendix B shape
npx tsx scripts/review-kits.ts out/kits.json              # Checkpoint B per-case review
npm run evaluate -- --input fixtures/cases-real.json --output out/kits-real.json
npm run dev                                               # workspace dev scripts if present
```

### API (`apps/api`) — T17a + T17b + T18 + T19b + T20

Express base with helmet, rate limiting, cookie sessions, and zod request validation. Contract: [`docs/API.md`](docs/API.md).

Auth routes: `GET /health`, `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`. JWT lives in an httpOnly `session` cookie (7 days, `SameSite=Lax`, `Secure` in production). Protected routes distinguish `401 UNAUTHENTICATED` (no cookie) from `401 SESSION_EXPIRED` (bad/expired cookie).

**Persistence (T17b):** Mongoose models `User`, `Kit`, `Job`, `PracticeState`. Kit reads (`GET /kits/:id`) always filter by `userId` — another owner's id returns `404 NOT_FOUND`.

**Generation jobs (T18):** `POST /kits` and `POST /kits/batch` enqueue an in-process worker that runs `runPipeline`, persisting step progress on the Job for polling via `GET /jobs/:id`. Idempotency key = `sha256(userId + normalised JD + URL + days)` — a second submit returns the same job (`200`) instead of starting another run. `POST /jobs/:id/retry` re-queues failed jobs (including boot-time `INTERRUPTED`). Kits are `validateKit`'d before save. The worker also stores the crawl `researchBundle` on the Kit so regenerate can skip a re-crawl.

**Edit + regenerate (T19b):** `PATCH /kits/:id` applies a batch of ops (`update` / `add` / `delete` / `reorder` / `move`) with optimistic concurrency via `baseVersion` (mismatch → `409 VERSION_CONFLICT` + current kit). Deleting a generated question records its normalised prompt in `kit.meta.dismissed`. `POST /kits/:id/regenerate` merges via `mergeRegenerated` (brief / schedule / one question category); schedule re-allocates with `allocateSchedule` when questions change.

**Practice (T20):** `POST /kits/:id/practice/review` records confidence (1–5) into Leitner boxes (≤2 → box 1, 3 → box 2, ≥4 → box+1 capped at 5). `GET /kits/:id/practice/next` returns the next-session queue (seen cards by box↑ / lastConfidence↑ / least-recently-seen; never-seen interleaved early) plus optional `hintStories` from Story Bank. `GET /kits/:id/practice/stats` reports covered/not-covered per requirement (≥1 reviewed flashcard linked to that req).

**Story Bank (T26):** `GET` / `PUT /kits/:id/story-bank` stores 0–6 STAR stories on the Kit (not Appendix A). Mapping onto behavioural requirements/questions is deterministic keyword overlap (no LLM). Uncovered behavioural requirements return `You have no story for '<text>'`. Practice cards show matching stories as hints. Does not bump kit `version`.

```bash
# requires JWT_SECRET and MONGODB_URI in .env (see .env.example); default PORT=4000
# optional: ALLOW_PRIVATE_HOSTS=true for localhost fixture company URLs
npm run dev --workspace=@prep/api
# or
npm start --workspace=@prep/api
```

### Web (`apps/web`) — T21 + T22a + T22b + T23a + T23b + T23c + T24 + T25 + T26 + T27

Auth UI + app shell against [`docs/API.md`](docs/API.md) only (no invented routes). Login/register/logout, `middleware.ts` gate for signed-out visitors, same-origin API client (`credentials: 'include'`, 401 → `/login?next=`), TanStack Query provider, dashboard empty state.

**Create kit** (`/kits/new`): JD textarea (char count + thin-JD warning under 80 chars), company URL, prep days 1–60. Client validation for empty JD / bad URL / days bounds. Submits `POST /kits`; a `200` (idempotent existing job) shows a duplicate-submit notice instead of starting a second run.

**Batch upload** (`/kits/batch`): JSON or CSV file → preview table with per-row validation → `POST /kits/batch` (1–50 `{ jd, company_url, days }`). Links to each job’s progress page.

**Job progress** (`/jobs/:id`): polls `GET /jobs/:id` while queued/running; step timeline (spinner / ✓ / skipped+reason / failed); sources found vs skipped from step details; elapsed time; safe-to-leave notice; `POST /jobs/:id/retry` when failed. When done, links to the kit builder.

**Kit builder** (`/kits/:id`): loads `GET /kits/:id`. Editable company brief (summary / what they do) and requirement text with must/nice badges, coverage (covered vs uncovered from `coverage.uncovered_requirement_ids`), and origin/edited badges. Edits stay local and flush as a debounced (600 ms) `PATCH /kits/:id` op batch (`baseVersion` + brief/requirement/question/flashcard update ops). Save status: Saved / Saving… / Offline (+ Retry). No full-page reload on save.

**Questions (T23b):** category tabs (technical / behavioural / system-design / company-fit); inline edit prompt + answer outline; optimistic reorder via `@dnd-kit` (PointerSensor + KeyboardSensor); move-to-category select; add / delete with undo toast; pin toggle; badges AI / Edited / Yours / Pinned. **Regenerate category** opens a confirm dialog listing protected items that will be kept (user / edited / pinned); pending text edits flush before `POST /kits/:id/regenerate` `{ section: "questions", category }`. `409 VERSION_CONFLICT` opens a merge prompt (reload latest) — never silent overwrite. Structural ops use `PATCH` reorder / move / update(pinned) / add / delete.

**Flashcards + Schedule / Brief regen (T23c):** Flashcards section with inline front/back edit, add / delete (+ undo), badges; ops via `PATCH` update/add/delete `flashcard`. Schedule section supports regenerate → `POST /kits/:id/regenerate` `{ section: "schedule" }` after flushing pending edits (does not clobber brief/questions/flashcards). Day-card detail and coverage matrix are T25. **Regenerate brief** confirm lists keep rules for edited/yours briefs; optional force → `{ section: "brief", force }` (skipped without force when edited; `MISSING_RESEARCH` surfaced from API).

**Practice (T24):** `/kits/:id/practice` — one flashcard at a time from `GET /kits/:id/practice/next` (API next-session / Leitner order; client does not re-sort). Space or Enter reveals the back; keys **1–5** submit `POST /kits/:id/practice/review`. Progress bar through the queue; session summary lists ratings; per-requirement covered / not-covered grid from `GET /kits/:id/practice/stats`. Matching Story Bank entries appear as a **Story hint** on the card. **Next session** reloads the API queue. Builder header links to Practice. Keyboard-only session supported.

**Story Bank (T26):** Builder section on `/kits/:id` via `GET`/`PUT /kits/:id/story-bank`. Write 4–6 STAR stories; flags behavioural requirements with no overlapping story.

**Schedule + coverage (T25):** Schedule day cards show focus, minutes, and questions linked by id (hash links to the Questions section). Interview date is derived client-side as kit `createdAt` local date + `days_available` (SPEC: days until the interview); the matching prep day gets a **Today** marker. Requirements × questions coverage matrix highlights rows in `coverage.uncovered_requirement_ids` (gap badge + amber row). Still uses only `GET /kits/:id` (+ existing regenerate). Wide tables scroll horizontally on phone.

**A11y + responsive (T27):** Keyboard-only walkthrough of auth → create/batch → job → builder → practice → Story Bank. Confirm/conflict dialogs trap Tab, close on Escape, and restore focus. Save status and job step timeline use `aria-live="polite"`. Loading skeletons replace bare “Loading…” copy. A React error boundary wraps the app. Layout tokens target **375px** (compact gutters, wrapping toolbars, overflow-x on tables). Skip link → `#main`.

Browser calls go to `/api/*`; Next rewrites strip the prefix to the Express origin (`API_ORIGIN`, default `http://localhost:4000`).

```bash
# terminal 1 — API (JWT_SECRET + MONGODB_URI required; see .env.example)
npm run dev --workspace=@prep/api
# terminal 2 — web (desktop)
npm run dev --workspace=@prep/web
```

Open `http://localhost:3000`. Signed-out visits to `/`, `/kits/new`, `/kits/batch`, `/kits/:id`, `/kits/:id/practice`, or `/jobs/:id` redirect to `/login`. After register/login, use **Create a kit** or **Batch upload** on the dashboard (list endpoint not in the contract yet — empty state only). Open a finished job’s **Open builder** link for Brief + Role + Questions + Flashcards + Schedule day cards + coverage matrix + Story Bank, then **Practice**.


### Batch CLI (`npm run evaluate`) — T16

Runs every case in `fixtures/cases.json` (or any Appendix B input array) through the **same** `runPipeline` the API will use:

- `--input` / `--output` via `node:util` `parseArgs`
- Concurrency **1** in the CLI entry (shared limiter; free-tier RPM makes concurrency 2 burn per-case timeouts waiting), shared LLM limiter (~8 RPM), ~8 min per-case timeout
- `runBatch` still supports concurrency 2 for tests / future API use

- `allowPrivateHosts: true` so localhost fixtures work
- One failing case never aborts the run; results are rewritten to `--output` after each case (partial Appendix B survives a crash)
- Prints a summary table + elapsed time; exits 0 when the batch finishes

Practical local run (needs a free-tier key in `.env` and fixtures up):

```bash
npm run fixtures   # separate terminal
npm run evaluate -- --input fixtures/cases.json --output out/kits.json
npm run check-output -- out/kits.json
```

On some Windows npm versions, `--input` / `--output` are eaten as unknown npm configs; the CLI still accepts the two paths as positionals (`npm run evaluate -- fixtures/cases.json out/kits.json`), which is what those npm versions forward.

## Research / crawl

Company research uses `safeFetch` + `cleanPage` + `crawl` / `rankLinks` (and optional `searchDiscussion`). Crawl stays on the seed’s **registrable domain** (eTLD+1 via [`tldts`](https://github.com/remusao/tldts)), so links like `handbook.gitlab.com` from `about.gitlab.com` are followed; same-host seeds still respect the path prefix (e.g. `/acme/`). Pages where cheerio extracts almost no text are logged as *little extractable content (likely client-rendered)* and are not treated as confirmed missing hiring pages.

Requirement priorities are re-checked in code: evidence/text cues (preferred, familiarity with, …), then nearest JD section heading, then the model’s label. LLM calls use temperature 0. Company briefs append an explicit note when no about or hiring page was crawled, and strip false “no hiring” claims when a hiring page was found.

Coverage loop: after must-gap fallbacks, if the question bank is still empty, seed a deterministic fallback question for every grounded requirement so thin/nice-only JDs never produce all-empty schedule days.

## Pipeline (`runPipeline`)

`packages/core/src/pipeline.ts` orchestrates the full kit build (same entry the batch CLI and API will call):

1. Validate input (non-empty JD, http(s) URL, integer days ≥ 1)
2. Extract + ground requirements from the JD only (no retrieval)
3. Crawl company site → search public discussion
4. Company brief + interview process
5. Questions per category → coverage loop (must-gap second pass + deterministic fallbacks)
6. Flashcards → deterministic schedule
7. Assemble `source` / `research_log` → `validateKit`

Progress callbacks receive `{ step, status: running|done|skipped|failed, detail? }`. Unreachable company sites still return an **ok** kit from the JD with `research_log.company_unreachable=true` (missing hiring page / partial research is not failure). `PipelineError` is thrown only when no kit is possible (`EMPTY_JD`, `LLM_UNAVAILABLE`, `INVALID_INPUT`, `INVALID_KIT`).

```ts
import { runPipeline } from "@prep/core";

const { kit } = await runPipeline(
  { jd, company_url, days },
  { allowPrivateHosts: true, onProgress: console.log },
);
```

Integration coverage: `packages/core/src/pipeline.test.ts` (fake LLM over all `fixtures/cases.json`).

### Crawl probe (Checkpoint A)

With fixtures (optional) or against a live URL:

```bash
npm run fixtures          # optional; for http://localhost:8099/acme/
npx tsx scripts/try-crawl.ts https://posthog.com
npx tsx scripts/try-crawl.ts http://localhost:8099/acme/
```

Writes JSON + log under `.loop/checkpoint-a/`. Review notes: `.loop/checkpoint-a.md`.

## Production deploy (T28) — config only until dashboards are filled

There is **no live deployment URL** in this repo yet. Wire the three free-tier services, then paste the Vercel URL into the submission.

**Do not add CORS.** The browser only calls same-origin `/api/*` on the Next app; `next.config.ts` rewrites that prefix to Express (`API_ORIGIN`).

### MongoDB Atlas (M0)

1. Create an M0 cluster and a database user.
2. Network access: allow `0.0.0.0/0` (Render free egress IPs are not stable) or pin Render IPs if you upgrade.
3. Copy the `mongodb+srv://…` URI into Render as `MONGODB_URI`.

### API — Render free web service (`render.yaml`)

Blueprint: [`render.yaml`](render.yaml). Create the service from this repo (or paste the `buildCommand` / `startCommand`). Fill **sync:false** secrets in the Render dashboard:

| Name | Required | Notes |
|---|---|---|
| `NODE_ENV` | yes | `production` (blocks private/loopback fetches unless `ALLOW_PRIVATE_HOSTS=true`) |
| `PORT` | set by Render | Listen binds `0.0.0.0` |
| `JWT_SECRET` | yes | Long random string. `Secure` cookies are on when `NODE_ENV=production` |
| `MONGODB_URI` | yes | Atlas SRV URI |
| `LLM_PROVIDER` | yes | `gemini` (default) or `groq` |
| `GEMINI_API_KEY` | if Gemini | Free-tier key |
| `GEMINI_MODEL` | no | Default `gemini-flash-lite-latest` |
| `GROQ_API_KEY` / `GROQ_MODEL` | optional fallback | |
| `SEARCH_API_KEY` | no | Discussion search |
| `ALLOW_PRIVATE_HOSTS` | **no** | Leave unset/false in production |

Health: `GET /health` → `{ ok: true }` (`healthCheckPath` in the blueprint).

**Sleep:** free instances sleep after idle; the first hit after sleep is often **~50s**. Boot marks leftover `running` jobs `failed` with `INTERRUPTED` (retry via `POST /jobs/:id/retry`). `POST /kits` stays async (~90s pipeline on the worker). **`POST /kits/:id/regenerate` is synchronous** (LLM). Node request timeout is 3 minutes on the API; the **Vercel rewrite proxy** may still cut it shorter (Hobby ~10s, Pro ~60s). If regen 504s, retry after the API is warm or raise the Vercel plan.

### Web — Vercel (`apps/web`)

Root Directory: `apps/web` (install/build already `cd ../..` in [`apps/web/vercel.json`](apps/web/vercel.json)).

| Name | Required | Notes |
|---|---|---|
| `API_ORIGIN` | yes | Public Render origin, **no trailing slash**, e.g. `https://YOUR-SERVICE.onrender.com` once you have it. **Baked at `next build`** — redeploy the web app after the API URL changes. |

No `JWT_SECRET` or Mongo on Vercel. No CORS plugin.

You must log into **Vercel**, **Render**, and **Atlas** (and paste `GEMINI_API_KEY` / `JWT_SECRET` / `MONGODB_URI` / `API_ORIGIN`) before T28’s live-URL acceptance is met.

## Known limitations

- **Batch evaluate without an LLM key** prints a startup `WARNING`, then records every case as `failed` with code `LLM_NOT_CONFIGURED` and a message pointing at `.env` / `.env.example` (`GEMINI_API_KEY` or `GROQ_API_KEY` for the active `LLM_PROVIDER`). Put a free-tier key in `.env` for real kits.
- **Job-board hosts** (Greenhouse / Lever / Ashby) are off-site and not followed.
- **Client-rendered shells:** if extracted text is near-empty after `cleanPage`, the crawl records *little extractable content (likely client-rendered)* on `skipped` and keeps the page as `other` — that is not evidence that a hiring page is missing.
- Classification can still label careers hubs as **about** when hiring-process copy is thin; budget can exhaust before high-signal paths are fetched.
- Robots are checked at origin `/robots.txt` only (path-prefixed fixture robots are not read).
- Without `SEARCH_API_KEY`, discussion search is HN + DuckDuckGo HTML only.
