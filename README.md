# Prep Kit

Interview prep kit generator (Trao FS-AI-INTERVIEW-01). Paste a job description and company URL; the pipeline researches the company and builds a kit (brief, requirements, questions, flashcards, schedule).

## Layout

npm workspaces:

- `packages/core` — schema, retrieval, LLM helpers, deterministic steps, pipeline pieces
- `apps/api` — Express API (auth, kits/jobs — see `docs/API.md`)
- `apps/web` — Next.js App Router UI (auth shell, dashboard, create-kit / batch upload, job progress, kit builder Brief + Role + Questions)
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

### API (`apps/api`) — T17a

Express base with helmet, rate limiting, cookie sessions, and zod request validation. Contract: [`docs/API.md`](docs/API.md).

Routes so far: `GET /health`, `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`. JWT lives in an httpOnly `session` cookie (7 days, `SameSite=Lax`, `Secure` in production). Protected routes distinguish `401 UNAUTHENTICATED` (no cookie) from `401 SESSION_EXPIRED` (bad/expired cookie). Users are **in-memory** until T17b (Mongo).

```bash
# requires JWT_SECRET in .env (see .env.example); default PORT=4000
npm run dev --workspace=@prep/api
# or
npm start --workspace=@prep/api
```

### Web (`apps/web`) — T21 + T22a + T22b + T23a + T23b

Auth UI + app shell against [`docs/API.md`](docs/API.md) only (no invented routes). Login/register/logout, `middleware.ts` gate for signed-out visitors, same-origin API client (`credentials: 'include'`, 401 → `/login?next=`), TanStack Query provider, dashboard empty state.

**Create kit** (`/kits/new`): JD textarea (char count + thin-JD warning under 80 chars), company URL, prep days 1–60. Client validation for empty JD / bad URL / days bounds. Submits `POST /kits`; a `200` (idempotent existing job) shows a duplicate-submit notice instead of starting a second run.

**Batch upload** (`/kits/batch`): JSON or CSV file → preview table with per-row validation → `POST /kits/batch` (1–50 `{ jd, company_url, days }`). Links to each job’s progress page.

**Job progress** (`/jobs/:id`): polls `GET /jobs/:id` while queued/running; step timeline (spinner / ✓ / skipped+reason / failed); sources found vs skipped from step details; elapsed time; safe-to-leave notice; `POST /jobs/:id/retry` when failed. When done, links to the kit builder.

**Kit builder — Brief + Role + Questions** (`/kits/:id`): loads `GET /kits/:id`. Editable company brief (summary / what they do) and requirement text with must/nice badges, coverage (covered vs uncovered from `coverage.uncovered_requirement_ids`), and origin/edited badges. Edits stay local and flush as a debounced (600 ms) `PATCH /kits/:id` op batch (`baseVersion` + brief/requirement/question update ops). Save status: Saved / Saving… / Offline (+ Retry). No full-page reload on save.

**Questions (T23b):** category tabs (technical / behavioural / system-design / company-fit); inline edit prompt + answer outline; optimistic reorder via `@dnd-kit` (PointerSensor + KeyboardSensor); move-to-category select; add / delete with undo toast; pin toggle; badges AI / Edited / Yours / Pinned. **Regenerate category** opens a confirm dialog listing protected items that will be kept (user / edited / pinned); pending text edits flush before `POST /kits/:id/regenerate` `{ section: "questions", category }`. `409 VERSION_CONFLICT` opens a merge prompt (reload latest) — never silent overwrite. Structural ops use `PATCH` reorder / move / update(pinned) / add / delete.

Browser calls go to `/api/*`; Next rewrites strip the prefix to the Express origin (`API_ORIGIN`, default `http://localhost:4000`).

```bash
# terminal 1 — API (JWT_SECRET + MONGODB_URI required; see .env.example)
npm run dev --workspace=@prep/api
# terminal 2 — web (desktop)
npm run dev --workspace=@prep/web
```

Open `http://localhost:3000`. Signed-out visits to `/`, `/kits/new`, `/kits/batch`, `/kits/:id`, or `/jobs/:id` redirect to `/login`. After register/login, use **Create a kit** or **Batch upload** on the dashboard (list endpoint not in the contract yet — empty state only). Open a finished job’s **Open builder** link for Brief + Role + Questions.


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

## Known limitations

- **Batch evaluate without an LLM key** prints a startup `WARNING`, then records every case as `failed` with code `LLM_NOT_CONFIGURED` and a message pointing at `.env` / `.env.example` (`GEMINI_API_KEY` or `GROQ_API_KEY` for the active `LLM_PROVIDER`). Put a free-tier key in `.env` for real kits.
- **Job-board hosts** (Greenhouse / Lever / Ashby) are off-site and not followed.
- **Client-rendered shells:** if extracted text is near-empty after `cleanPage`, the crawl records *little extractable content (likely client-rendered)* on `skipped` and keeps the page as `other` — that is not evidence that a hiring page is missing.
- Classification can still label careers hubs as **about** when hiring-process copy is thin; budget can exhaust before high-signal paths are fetched.
- Robots are checked at origin `/robots.txt` only (path-prefixed fixture robots are not read).
- Without `SEARCH_API_KEY`, discussion search is HN + DuckDuckGo HTML only.
