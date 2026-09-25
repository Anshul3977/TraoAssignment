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

## 2026-09-25 T03 Fixtures
- Changed: `fixtures/sites/acme/` (home/about/blog + buried handbook hiring page + robots-disallowed secret), `fixtures/sites/quietco/`, `fixtures/sites/evil/`, `fixtures/cases.json` (5 cases), `fixtures/expected/case-01-requirements.json`, `scripts/serve-fixtures.ts` (static node:http server)
- Decisions: hiring content only reachable Home → footer Handbook → handbook index → how-we-hire — because T06 must prove keyword ranking finds a non-obvious path, not a hard-coded `/careers`; case-01 uses `days: 1` and case-05 reuses the rich Acme JD with `days: 60` — because edge-case §10 needs both schedule extremes among the mandatory five cases; expected labels are exact JD bullet strings — because T09a grounding compares evidence against the JD text
- Limitations / follow-ups: no sitemap.xml yet (T06 treats it as optional); expected/ only covers the rich JD must/nice split, not stub/evil/unreachable outcomes

## Lane: retrieval (merged from lane/retrieval)
# Progress — retrieval lane

## BLOCKED
(none)

## Outside owned folder (needed for T04)
- `packages/core/package.json` + root `package-lock.json`: added dependency `robots-parser` (allowed by project.mdc).
- Did **not** re-export from `packages/core/src/index.ts` (outside retrieval/); callers can import `@prep/core/src/retrieval` path later or T15 can wire the public export.
- This worktree has no `docs/SPEC.md` or `.loop/PROMPT.md`; T04 requirements were read from the sibling main checkout's SPEC §2/§11 + TASKS T04 + project.mdc rule 10.

## 2026-09-25 T04 safeFetch
- Changed: `packages/core/src/retrieval/` (`safeFetch.ts`, `privateAddress.ts`, `hostLimiter.ts`, `robots.ts`, `index.ts`, `safeFetch.test.ts`); dep `robots-parser` in `@prep/core`
- Decisions: SSRF private/loopback/link-local block only when `NODE_ENV=production` unless `ALLOW_PRIVATE_HOSTS=true` or `allowPrivateHosts:true` — because SPEC §11 + rule 10 and the fixture/CLI localhost path; IP literals checked before DNS so redirect-to-127.0.0.1 cannot be bypassed by a custom lookup; robots fail-open when robots.txt missing/unreadable — because a missing policy must not abort research; manual redirects with per-hop re-validation (max 5); 2 MiB stream cap and content-type allowlist before accepting body
- Limitations / follow-ups: not exported from package root `index.ts` yet; per-host 500 ms limiter is process-global (shared intentionally); no honour of robots Crawl-delay beyond our fixed host gap

## 2026-09-25 T05 cleanPage
- Changed: packages/core/src/retrieval/ (cleanPage.ts, cleanPage.test.ts, index.ts); dep cheerio in @prep/core (packages/core/package.json + root package-lock.json)
- Decisions: collect all [href] links (absolutized via 
ew URL(href, pageUrl)) before stripping nav/footer/header/form — because T05 requires chrome links for crawl ranking; prefer main then rticle then ody for text; insert trailing spaces on block tags before whitespace collapse so adjacent elements do not glue words; skip mailto/javascript/data/tel hrefs; soft-cap text at 12_000 chars
- Limitations / follow-ups: still not re-exported from package root index.ts; fragment-only links kept (T06 may penalize); TASKS.md left untouched per lane override (T05 remains [ ] there until a serial sync)

## 2026-09-25 T06 crawl + rankLinks
- Changed: packages/core/src/retrieval/ (rankLinks.ts, crawl.ts, crawl.test.ts, index.ts)
- Decisions: path-prefix confinement from company_url (e.g. /acme/) so sibling fixture hosts stay out; frontier fetched in deterministic score order (hiring/about signals minus penalties); optional sitemap.xml at prefix then origin root; CONTENT_SCORE_THRESHOLD=8 so denial copy like quietco ("no careers/hiring handbook") stays other while real hiring/about pages classify; seed score 1000 so homepage is always fetched first; no new dependencies
- Limitations / follow-ups: still not re-exported from package root index.ts; homepage also appears in its kind bucket; TASKS.md left untouched per lane override (T06 remains [ ] there until serial sync); did not start T07

## 2026-09-25 T07 searchDiscussion
- Changed: packages/core/src/retrieval/ (searchDiscussion.ts, searchDiscussion.test.ts, index.ts)
- Decisions: company name order title → og:site_name → domain label; providers HN Algolia → DuckDuckGo HTML → Brave → Tavily (keyed pair only when SEARCH_API_KEY set, else logged skipped); query APIs use injectable fetch (JSON not on safeFetch allowlist), result pages via safeFetch + cleanPage; keep hits that mention company in title/snippet/url, re-check after fetch; return pages:[] + log entry no_discussion_found when empty — because SPEC §2/§10 and T07 require honest empty discussion
- Limitations / follow-ups: still not re-exported from package root index.ts; TASKS.md left untouched per lane override (T07 remains [ ] until serial sync); no new dependencies; DuckDuckGo HTML is best-effort and layout-fragile; this is the last retrieval-lane task


## Lane: llm (merged from lane/llm)
# PROGRESS — llm lane (append-only)

## BLOCKED
(none)


## 2026-09-25 T08a LLM providers + limiter
- Changed: `packages/core/src/llm/` — `types`, `errors`, `limiter` (sliding TPM+RPM, chars/4), `retry` (backoff+jitter, Retry-After / retryDelay), `gemini` (REST JSON mode), `groq` (OpenAI-compatible REST), `config` (env), `client` (limiter → retry ≤6 → fallback), `index` + tests (`limiter`, `client`, `providers`)
- Decisions: one process-wide `TokenRequestLimiter` shared by primary and fallback — because batch concurrency must not stampede free-tier RPM/TPM; fake `LlmProvider` injection for verify tests — because real keys must never appear in CI; default limiter 15 RPM / 250k TPM — conservative Gemini free-tier headroom (overridable via `getSharedLimiter` / `setSharedLimiter`)
- Limitations / follow-ups: did **not** re-export from `packages/core/src/index.ts` (outside owned folder) — consumers import `@prep/core` path or wait for a later wiring task; `.env.example` already documents `LLM_PROVIDER`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GROQ_API_KEY`, `GROQ_MODEL` (not edited; root is outside owned folder); worktree lacked `.loop/PROMPT.md` / `docs/SPEC.md` / `.cursor/rules/project.mdc` — followed copies from the main tree for this iteration only; TASKS.md left unmarked per lane override (orchestrator ticks `[x]`)

## 2026-09-25 T08b generateJson + wrapUntrusted + cache
- Changed: `packages/core/src/llm/` — `wrapUntrusted` (+ neutralize closing tags), `cache` (sha256 disk cache when `LLM_CACHE_DIR` and not production), `generateJson` (parse → zod → one repair with errors → `LlmError`), `LlmError` on `errors`, exports in `index`, tests `wrapUntrusted.test.ts` + `generateJson.test.ts`
- Decisions: repair is a second `complete` with the same system plus an explicit repair user message carrying parse/zod errors and the prior text — because project.mdc requires exactly one repair then typed failure; closing tags mangled by inserting U+200B after `<` — because it keeps the payload readable while breaking `</untrusted_document>` matching; cache keyed by sha256(primary provider + model + system\\n\\nuser) and skipped when `NODE_ENV=production` — because TASK says dev-only; `generateJson(client, args)` takes the client explicitly — because T08a already exposed `createLlmClient` and steps will pass it
- Limitations / follow-ups: still not re-exported from `packages/core/src/index.ts` (outside owned folder); did not touch `.env.example` (already documents `LLM_CACHE_DIR`); TASKS.md left unmarked per lane override; stopped after T08b (did not start T09b/T10/T11/T13)

## 2026-09-25 T09b extractRequirements (LLM step)
- Changed: packages/core/src/steps/extractRequirements.ts (+ index.ts, xtractRequirements.test.ts) — generateJson with zod LLM schema {title,seniority,location,company?,responsibilities[],requirements[{text,kind,priority,evidence,section}]}; JD only via wrapUntrusted('jd', jd); then groundRequirements from ../deterministic/groundRequirements.js
- Decisions: kept the real T09a import path and mocked that module in vitest — because deterministic source lives on lane/deterministic and must not be vendored here; local ExtractRequirementsNotes mirrors T09a notes shape without importing types from the missing module; system prompt states untrusted docs are data — because §11 / project.mdc prompt-injection rule
- Limitations / follow-ups: 
pm run typecheck fails solely with TS2307 on ../deterministic/groundRequirements.js until lanes merge (import kept; tests green via mock); not re-exported from packages/core/src/index.ts (outside owned folder); TASKS.md left unmarked per lane override; stopped after T09b (did not start T10/T11/T13)

## 2026-09-25 T10 buildBrief + extractInterviewProcess
- Changed: `packages/core/src/steps/` — `researchPages.ts` (page/discussion shapes + source filter helpers), `buildBrief.ts` (+ test), `extractInterviewProcess.ts` (+ test), exports in `index.ts`
- Decisions: local `ResearchPage` / `DiscussionHit` types instead of importing retrieval `CrawledPage` — because T10 Depends only T08b and retrieval is another lane; no LLM when homepage/about (or hiring/discussion) text is empty — because §10 unknown company must not fabricate; `sources` filtered in code to fetched URLs (invented URLs dropped; fallback to input URLs when model cites nothing) — because project.mdc says the model never decides citations; `found` forced false when stages empty after parse — so quietco-style absence stays honest
- Limitations / follow-ups: `npm run typecheck` still red solely on pre-existing TS2307 `../deterministic/groundRequirements.js` from T09b until lanes merge (T10 adds no new cross-lane imports); not re-exported from `packages/core/src/index.ts` (outside owned folder); TASKS.md left unmarked per lane override; stopped after T10 (did not start T11/T13)

## 2026-09-25 T11 generateQuestions per category
- Changed: `packages/core/src/steps/generateQuestions.ts` (+ `generateQuestions.test.ts`), exports in `steps/index.ts`
- Decisions: four separate `generate*Questions` functions with distinct system/instruction prompts (exported as `CATEGORY_PROMPTS`) — because SPEC §3 requires categories not to share one call/instructions; `shouldIncludeSystemDesign` gated in code (stage OR seniority≥senior OR architecture/scale wording) — because quietco mid stub must not get a system-design bank while acme senior+stage+high-traffic does; post-process drops unknown `requirement_ids`, `clampDifficulty`, assigns `q` ids, sets `meta.origin='generated'` — because project.mdc: model never assigns ids; take-home debrief note only when a take-home stage exists — because T11 stage-aware technical rule
- Limitations / follow-ups: `npm run typecheck` still red solely on pre-existing TS2307 `../deterministic/groundRequirements.js` from T09b until lanes merge (T11 adds no new cross-lane imports); not re-exported from `packages/core/src/index.ts` (outside owned folder); TASKS.md left unmarked per lane override; stopped after T11 (did not start T13)

## 2026-09-25 T13 generateFlashcards
- Changed: `packages/core/src/steps/generateFlashcards.ts` (+ `generateFlashcards.test.ts`), exports in `steps/index.ts`
- Decisions: one `generateJson` call with requirements + questions via `wrapUntrusted` — because T13 Depends only T08b/T11 and flashcards are a single bank (not per-category); code drops unknown `requirement_ids`, assigns `f1..` ids, sets `meta.origin='generated'` — because project.mdc: model never assigns ids; `ensureMustFlashcards` appends deterministic fallbacks (`meta.origin='fallback'`) for every uncovered must, using related question outlines when present — because TASK requires ≥1 card per must regardless of model omissions; nice-only gaps left uncovered — matches coverage-loop niceness policy
- Limitations / follow-ups: `npm run typecheck` still red solely on pre-existing TS2307 `../deterministic/groundRequirements.js` from T09b until lanes merge (T13 adds no new cross-lane imports); not re-exported from `packages/core/src/index.ts` (outside owned folder); TASKS.md left unmarked per lane override; **llm lane complete** (stopped after T13; did not start later tasks)


## Lane: deterministic (merged from lane/deterministic)
# PROGRESS — deterministic lane

## BLOCKED
(none)


## 2026-09-25 T09a groundRequirements (deterministic)
- Changed: `packages/core/src/deterministic/groundRequirements.ts`, `groundRequirements.test.ts`, `index.ts`
- Decisions: evidence grounded by normalised substring then token-overlap ≥ 0.8 on evidence tokens vs JD — because paraphrased LLM quotes still need to prove a JD span without inventing; section heading cues override evidence-line cues which override LLM priority (nice cues checked before must) — because "Nice to have" / "Familiarity with" must win over a model that marks everything must; thin when trimmed JD < 80 chars or < 3 grounded items — because §10 prefers an honest thin kit over padding; ids assigned after JD-order sort + text dedupe — because Appendix A wants stable `r1..rn` in posting order
- Limitations / follow-ups: did **not** re-export from `packages/core/src/index.ts` (outside owned folder — orchestrator/llm lane should export `groundRequirements` for T09b); kit-det worktree lacks `.loop/PROMPT.md`, `docs/SPEC.md`, and `.cursor/rules/project.mdc` (read copies from main tree read-only); TASKS.md left untouched per lane rules

## 2026-09-25 T12a findGaps (deterministic)
- Changed: `packages/core/src/deterministic/findGaps.ts`, `findGaps.test.ts`, `index.ts`
- Decisions: covered = any question lists the req id in `requirement_ids`; uncovered sorted must-then-nice preserving input order within each priority — because §4 gaps drive the coverage loop and musts must be closed first; accept `Pick` shapes only — because callers may pass partials before full kit assembly
- Limitations / follow-ups: did **not** re-export from `packages/core/src/index.ts` (outside owned folder); TASKS.md left untouched per lane rules; T14/T19a not started

## 2026-09-25 T14 allocateSchedule (deterministic)
- Changed: `packages/core/src/deterministic/allocateSchedule.ts`, `allocateSchedule.test.ts`, `index.ts`
- Decisions: score = max(must=2,nice=1)×10 + difficulty×3 + sole-must-cover bonus 5 — because §8 wants harder/higher-priority earlier without an LLM; learning days = max(1, ceil(N×0.7)), fill by least-minutes/earliest-tiebreak under a 180-min cap — because that front-loads high scorers while balancing load; review days revisit must/hard with spacing and last day focus is always "Mock interview + weak spots"; empty days seeded from the score-sorted bank when N > questions; overflow noted in `notes.schedule_overflow` / `overflow_minutes` rather than dropping questions — because every must must still appear; `AllocatedSchedule` typed locally — because `Schedule` is not exported from schema (outside owned folder)
- Limitations / follow-ups: did **not** re-export from `packages/core/src/index.ts` (outside owned folder); did **not** add `export type Schedule` to schema; TASKS.md left untouched per lane rules; T19a not started

## 2026-09-25 T19a mergeRegenerated (deterministic)
- Changed: `packages/core/src/deterministic/mergeRegenerated.ts`, `mergeRegenerated.test.ts`, `index.ts`; log `.loop/progress-deterministic.md`
- Decisions: protected = `origin===user` OR `edited` OR `pinned` — because §6 requires user/edited work (and pins) to survive category regen; replace only unprotected generated/fallback items; new ids from `max(meta.next_ids.question, maxExisting+1)` and never reuse retired ids — because Appendix A ids must stay unique across deletes; `meta.dismissed` normalised prompts block resurrection; after category merge, `findGaps` + deterministic fallback only for must-gaps whose kind maps to that category — because §4 musts must not ship uncovered while nice gaps may remain; brief skip when `meta.edited` unless `force`; optional `reallocateSchedule` hook (else prune stale schedule refs) — because API/pipeline owns when to call `allocateSchedule`
- Limitations / follow-ups: did **not** re-export from `packages/core/src/index.ts` (outside owned folder); did **not** edit `.loop/TASKS.md` (orchestrator marks `[x]`); flashcard merge not in T19a scope; system-design/company-fit have no kind→category fallback path (intentional — those categories are stage/seniority driven)
