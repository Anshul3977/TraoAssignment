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

## Research / crawl status

Company research uses local HTML fixtures (`fixtures/sites/`) plus a polite `safeFetch` (rate limits, robots.txt, SSRF guards). Public discussion search is optional and failure-tolerant. This is not a finished product crawler; Checkpoint A (real-site crawl review) is still open.
