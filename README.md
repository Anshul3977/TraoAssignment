# Prep Kit

Interview prep kit generator (Trao FS-AI-INTERVIEW-01). Paste a job description and company URL; the pipeline researches the company and builds a kit (brief, requirements, questions, flashcards, schedule).

## Layout

npm workspaces:

- `packages/core` — schema, retrieval, LLM helpers, deterministic steps, pipeline pieces
- `apps/api` — Express API (scaffold; auth/jobs not fully wired yet)
- `apps/web` — Next.js App Router UI (scaffold)

## Setup

```bash
npm install
```

Requires Node ≥ 20. Copy `.env.example` to `.env` and fill values as needed. Do not commit secrets.

## Commands

```bash
npm run typecheck
npm test
npm run fixtures   # serves fixtures/sites on :8099
npm run evaluate   # batch CLI (after pipeline wiring)
npm run dev        # workspace dev scripts if present
```

## Research / crawl

Company research uses `safeFetch` + `cleanPage` + `crawl` / `rankLinks` (and optional `searchDiscussion`). Crawl stays on the seed’s **registrable domain** (eTLD+1 via [`tldts`](https://github.com/remusao/tldts)), so links like `handbook.gitlab.com` from `about.gitlab.com` are followed; same-host seeds still respect the path prefix (e.g. `/acme/`). Pages where cheerio extracts almost no text are logged as *little extractable content (likely client-rendered)* and are not treated as confirmed missing hiring pages.

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

- **Job-board hosts** (Greenhouse / Lever / Ashby) are off-site and not followed.
- **Client-rendered shells:** if extracted text is near-empty after `cleanPage`, the crawl records *little extractable content (likely client-rendered)* on `skipped` and keeps the page as `other` — that is not evidence that a hiring page is missing.
- Classification can still label careers hubs as **about** when hiring-process copy is thin; budget can exhaust before high-signal paths are fetched.
- Robots are checked at origin `/robots.txt` only (path-prefixed fixture robots are not read).
- Without `SEARCH_API_KEY`, discussion search is HN + DuckDuckGo HTML only.
