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
