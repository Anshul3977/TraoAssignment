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

## 2026-09-25 T12b Coverage loop (second pass)
- Changed: `packages/core/src/steps/coverageLoop.ts` (+ `coverageLoop.test.ts`), exports in `steps/index.ts`; `.loop/TASKS.md` marked [x]
- Decisions: pass 1 = supplied draft; while must-gaps and passes < 3, call `generateTechnicalQuestions` / `generateBehaviouralQuestions` only for those must-gap reqs (via `categoryForRequirementKind`) — because §4/T12b routes by kind and system-design/company-fit are not kind-driven; after cap, deterministic `fallbackQuestionFor` with `meta.origin='fallback'` so no must ships uncovered; nice-only gaps never enter the loop; `research_log.coverage_passes` records per-pass must/nice gaps + added ids
- Limitations / follow-ups: not re-exported from `packages/core/src/index.ts` yet (T15 will wire); fallback log entry reuses the final `passes` number rather than inventing pass 4; CHECKPOINT A still open (human) and was not started

## 2026-09-25 Checkpoint A — proposals 1 + 3 (subdomains + thin shells)
- Changed: `packages/core/src/retrieval/crawl.ts` (+ tests, index exports), `README.md`, `scripts/try-crawl.ts`, `.loop/checkpoint-a.md`, `.loop/TASKS.md`
- Decisions: added dependency **tldts** so crawl can follow sibling subdomains of the same registrable domain (eTLD+1), including multi-part suffixes like `.co.uk` (e.g. `about.gitlab.com` → `handbook.gitlab.com`); same-host seeds still enforce path prefix for fixture isolation; thin `cleanPage` text (< `LITTLE_EXTRACTABLE_TEXT_CHARS`) records `little extractable content (likely client-rendered)` on `skipped` and forces kind `other` so SPA shells are not treated as a confirmed missing hiring page — because Checkpoint A proposals 1 and 3
- Limitations / follow-ups: did **not** apply proposals 2, 4, 5, 6, 7, or 8; did **not** start T15; job-board host allowlist and frontier re-ranking still open

## 2026-09-25 T15 runPipeline
- Changed: `packages/core/src/pipeline.ts` (+ `pipeline.test.ts`), exports in `packages/core/src/index.ts`, `README.md`, `.loop/TASKS.md`
- Decisions: single `runPipeline` orchestrates extract → crawl → discussion → brief/process → questions → coverage → flashcards → schedule → `validateKit` — because CLI and API must share one path (project.mdc §9); unreachable crawl still yields an ok kit with `research_log.company_unreachable=true` and honest empty brief — because FAQ: partial research ≠ failed; `PipelineError` only for empty JD / invalid input / LLM dead on extract / assembled kit invalid; non-critical LLM failures on brief/process/questions/flashcards degrade (honest empty / empty process / coverage+flashcard fallbacks) and record `research_log.skipped` — because §2 skipped sources never abort; injectable `client` / `crawlFn` / `searchDiscussionFn` + `onProgress` — because integration tests use a fake LLM and stub discussion without hitting live search
- Limitations / follow-ups: batch CLI (`npm run evaluate` args) is T16; discussion is stubbed empty in the T15 integration test (real providers remain available when not injected); `interview_process` lives under `research_log` until a dedicated optional kit field is added

## 2026-09-25 T16 Batch CLI
- Changed: `packages/core/src/cli/evaluate.ts`, `packages/core/src/cli/runBatch.ts` (+ `runBatch.test.ts`), `scripts/check-output.ts`, root `package.json` (`check-output` script), `README.md`, `.loop/TASKS.md`
- Decisions: `runBatch` wraps the shared `runPipeline` with concurrency 2, 4 min per-case timeout, and a rewrite of Appendix B after every case — because SPEC §9 / T16 require partial results to survive a crash and one failure must not abort the batch; CLI forces `allowPrivateHosts: true` — because evaluator fixtures are on localhost; accept positional `<input> <output>` when npm strips `--input`/`--output` on Windows — because the SPEC command still has to work under that npm quirk; `scripts/check-output.ts` validates with `BatchOutputSchema` only — because Appendix B shape is the contract, not kit-quality review (Checkpoint B)
- Limitations / follow-ups: no free-tier LLM key in this environment — live evaluate recorded 5× `failed` (missing `GEMINI_API_KEY`) but still exited 0 and passed `check-output`; re-run with `.env` keys for real kits before Checkpoint B; did not start T17 / Checkpoint B

## 2026-09-25 Checkpoint B
- Changed: CLI missing-key path, Gemini defaults/temperature, evaluate concurrency/timeout/limiter, groundRequirements cue precedence, buildBrief honesty, coverage empty-bank fallbacks, `scripts/review-kits.ts`, `fixtures/cases-real.json`, `.loop/checkpoint-b.md`, TASKS Checkpoint B [x]
- Decisions: free-tier daily caps are per-model so default `gemini-flash-lite-latest`; evaluate concurrency 1 so cases do not burn timeouts waiting on the shared limiter; evidence/text preferred cues beat invented LLM section labels; strip false no-hiring claims when hiring pages were crawled; empty question banks get deterministic fallbacks so schedules are never all-empty
- Limitations / follow-ups: did **not** start T17a; crawler proposals 2/4/5/6/7/8 not applied; GitLab real kit left two nice gaps uncovered (policy-allowed)

## 2026-09-25 T17a API base + auth + API.md
- Changed: `apps/api/` (Express `createApp`, helmet, rate-limit, cookie-parser, zod validate middleware, auth register/login/logout/me, health, in-memory user store, supertest `auth.test.ts`); `docs/API.md`; `README.md`; small typefix in `groundRequirements.test.ts` (`text` on `overridePriority` fixtures) so root typecheck stays green
- Decisions: JWT in httpOnly `session` cookie (7d, SameSite=Lax, Secure only when `NODE_ENV=production`) — because local Next rewrite is HTTP and Secure cookies would break local sessions; `UNAUTHENTICATED` vs `SESSION_EXPIRED` split on whether a cookie was present — because SPEC §1 wants sensible expired-session handling; in-memory user store until T17b Mongoose — because T17a owns auth wire-up only and must not invent kit/job routes; `docs/API.md` is the web contract and lists only health + auth for now
- Limitations / follow-ups: accounts reset on API restart; kit/job/practice routes are T17b–T20; did not start T17b

## Lane: api (merged from lane/api)
# PROGRESS — api lane

## BLOCKED
(none)

## Outside apps/api/ this iteration
- `README.md` (required in same commit)
- `docs/API.md` — practice routes (T20) documented for web (T24)
- `.loop/progress-api.md` (this log; TASKS.md not edited per lane rules)

## 2026-09-25 T20 Practice API
- Changed: `apps/api/src/practice/{leitner,schema,store,routes}.ts`, `practice.test.ts`, `kits/routes.ts`; `docs/API.md`; `README.md`; `.loop/progress-api.md`
- Decisions: Leitner boxes on review (≤2→1, 3→2, ≥4→box+1 capped at 5) with never-seen interleaved early before each sorted seen card — because §7 asks for spaced repetition and "next session" ordering the web can poll without reimplementing; requirement covered when ≥1 linked flashcard has `lastSeenAt` — because T24 needs a covered/not grid and empty flashcard sets stay honest; pure `orderNextSession` / `nextLeitnerBox` unit-tested separately from Mongo — because Verify is ordering-focused; PracticeState upserted per user+kit — because §13 reopen/continue
- Limitations / follow-ups: deleted flashcards may leave orphan PracticeState card rows (harmless; `/next` only returns current kit cards); api lane complete at T20 — no web tasks started; TASKS.md left unmarked per lane rules

## 2026-09-25 T19b Edit + regenerate API
- Changed: `apps/api/src/kits/{opsSchema,applyOps,regenerate,routes,store}.ts`, `lib/prepCore.ts`, `jobs/worker.ts`, `app.ts`, `edit.test.ts`, `tsconfig.json`; `docs/API.md`; `README.md`; `.loop/progress-api.md`
- Decisions: PATCH ops are a zod union (`update`/`add`/`delete`/`reorder`/`move`) with optimistic `baseVersion` → `409 VERSION_CONFLICT` + current kit — because §6 / T23b must never silent-overwrite; delete of generated/fallback prompts appends `normalisePrompt` into `kit.meta.dismissed` — because merge must not resurrect; regenerate calls `mergeRegenerated` + `allocateSchedule` from core via relative `lib/prepCore` (public `@prep/core` entry lacks those exports) — because T19b must not reimplement merge; worker wraps crawl to persist `researchBundle` on Kit create — because runPipeline returns kit-only and brief regen needs homepage/about text without re-crawl; injectable `buildBriefFn` / `generateCategoryFn` for API tests — because Verify mirrors T19a without live LLM keys
- Limitations / follow-ups: kits created before this change (or via test runners that skip crawlFn) may lack `researchBundle` → brief regen returns `409 MISSING_RESEARCH`; practice routes are T20 (not started); TASKS.md left unmarked per lane rules

## 2026-09-25 T18 Generation jobs
- Changed: `apps/api/src/jobs/{idempotency,schema,store,service,worker,routes}.ts`, `jobs.test.ts`, `kits/routes.ts`, `app.ts`, `index.ts`; `docs/API.md`; `README.md`
- Decisions: idempotency key = sha256(userId + collapsed-whitespace JD + canonical URL + days) with unique `(userId, idempotencyKey)` — because §10 same JD+company must not spawn a second pipeline; in-process `JobWorker` persists step upserts and runs injectable `runPipeline` — because long ~90 s runs must be poll-friendly without a separate queue product; boot marks `running` → `failed`/`INTERRUPTED` and re-enqueues leftover `queued` — because §13 reopen/continue after restart; `validateKit` again before `Kit` insert — because task requires structure check before save even though the pipeline already validates; failed jobs returned as-is on `POST /kits` (explicit `POST /jobs/:id/retry`) — because unique key forbids a second row and retry must be intentional for mid-fail
- Limitations / follow-ups: `researchBundle` not yet stored on Kit (pipeline still returns kit only; T19b regenerate); no `GET /kits` list (not in T18); did not start T19b/T20; TASKS.md left unmarked; `docs/SPEC.md` missing from this worktree — followed TASKS + cited §10/§13 behaviours

## 2026-09-25 T17b Persistence models + kit scoping
- Changed: `apps/api/src/models/{User,Kit,Job,PracticeState}.ts`, `db/connect.ts`, `auth/mongooseStore.ts`, `kits/{store,routes}.ts`, `app.ts`, `index.ts`, `persistence.test.ts`; `apps/api/package.json` (+ mongoose, mongodb-memory-server); `docs/API.md`; `README.md`
- Decisions: all kit reads go through `findKitForUser(kitId, userId)` so foreign kits are indistinguishable from missing (404) — because §1 forbids reading others' kits; User/Kit/Job/PracticeState models store input + Appendix A kit + researchBundle + Leitner card boxes + job steps/status — because §13 requires enough to reopen and continue after restart; production `index.ts` requires `MONGODB_URI` and uses `createMongooseUserStore` while tests may still inject the in-memory store — because auth unit tests stay fast and T17a coverage remains; `mongodb-memory-server` as api devDependency — because T17b Verify mandates it (justified; not on the default allowlist alone)
- Limitations / follow-ups: no POST/list/job/practice routes yet (T18–T20); in-memory `UserStore` kept for injectable tests only; did not start T18; TASKS.md left unmarked


## Lane: web (merged from lane/web)
# Web lane progress

## 2026-09-25 T21 Auth UI + shell
- Changed: `apps/web/` (auth pages, middleware, API client, Query provider, dashboard empty state, rewrite fix), root `README.md`
- Decisions:
  - Browser paths `/api/*` rewrite to Express `/:path*` (not `/api/:path*`) — because `docs/API.md` mounts `/auth/*` and `/health` at the API root; the previous scaffold destination double-prefixed `/api` and would 404.
  - Dashboard shows empty kits state without calling a kit list endpoint — because `docs/API.md` (T17a) has no kit CRUD routes yet ("Do not call kit/job routes until they appear here"). CTA links to `/kits/new` for T22a.
  - Middleware gates on `session` cookie presence only; JWT validity checked via `GET /auth/me` on the dashboard server render — because the web app does not hold `JWT_SECRET` and the contract puts auth enforcement on the API.
  - API client always uses `credentials: 'include'` and maps contract paths through `/api` — because same-origin cookies per project.mdc / API.md.
- Limitations / follow-ups: no `GET /kits` in contract → cannot list real kits until T17b/T18 extend API.md; `/kits/new` is CTA-only until T22a; desktop-focused layout.

## 2026-09-25 T22a Create kit form
- Changed: `apps/web/` (validation helpers + tests, `createKit` API client, `/kits/new` page + `CreateKitForm`), root `README.md`
- Decisions:
  - Thin-JD warning at 80 trimmed chars — because core `groundRequirements` uses the same `THIN_JD_CHARS` threshold for `notes.thin_jd`.
  - `createKit` treats HTTP `201` as new job and `200` as idempotent existing — because `docs/API.md` `POST /kits` documents that split; duplicate-submit notice only on `200`.
  - Form stays on `/kits/new` after success with a link to `/jobs/:id` — because T22b owns the job progress page; do not invent poll UI here.
  - Client validation mirrors API.md field rules (non-empty JD ≤100k, http(s) URL ≤2048, days integer 1–60) before `POST /kits`.
- Limitations / follow-ups: job timeline / batch upload are T22b; no kit list until a list route appears in API.md.

## 2026-09-25 T22b Batch upload + job progress
- Changed: `apps/web/` (batch parse/validate, `/kits/batch`, job view helpers + `/jobs/[id]` progress UI, API client `createKitsBatch` / `getJob` / `retryJob`, tests), root `README.md`
- Decisions:
  - Browser parses JSON/CSV locally into `{ jd, company_url, days }[]` then `POST /kits/batch` — because API.md says the web app parses the uploaded file; do not invent a multipart upload route.
  - Job page polls `GET /jobs/:id` every 2s while queued/running — because generation is async (~90s) and progress is persisted (safe to leave and return).
  - Sources found/skipped derived from step timeline details (done crawl/search/extract vs skipped+detail) — because the Job object has no separate sources field in API.md.
  - Failed jobs expose Retry via `POST /jobs/:id/retry` only — because 409 `NOT_RETRYABLE` covers non-failed statuses.
- Limitations / follow-ups: no kit list/builder until those routes land in API.md + T23a; desktop only.

## 2026-09-25 T23a Builder — Brief + Role
- Changed: `apps/web/` (`/kits/[id]` page, `KitBriefRoleBuilder`, `kit-builder` helpers + tests, API client `getKit` / `patchKit` / conflict helper, job “Open builder” link), root `README.md`, `.loop/progress-web.md`
- Decisions:
  - Brief + Role only on `/kits/:id` via `GET /kits/:id` + `PATCH /kits/:id` — because T23a scope; questions/flashcards/regen are T23b/T23c; do not invent list or other endpoints.
  - Local draft + 600 ms debounced op-batch (`update` brief / requirement) — because task Verify requires inline edit without full-page reload and API.md documents op batches with `baseVersion`.
  - Save status Saved / Saving… / Offline (+ Retry); network `TypeError` → Offline; `VERSION_CONFLICT` adopts returned kit — because contract returns current kit on 409 and T23b owns richer merge UX.
  - Coverage badge from `coverage.uncovered_requirement_ids`; must/nice + origin/edited badges from requirement/brief meta — because Appendix A + API.md extensions.
- Limitations / follow-ups: no questions UI / regen / flashcards / schedule (T23b–c); no kit list route yet; desktop only.

## 2026-09-25 T23b Builder — Questions
- Changed: `apps/web/` (`KitQuestionsSection`, builder integration, kit-builder helpers + tests, `regenerateKitQuestions` API client, `@dnd-kit` deps), root `README.md`, `package-lock.json`, `.loop/progress-web.md`
- Decisions:
  - Questions on same `/kits/:id` builder as Brief + Role — because T23b extends the kit page; flashcards/schedule regen stay T23c.
  - Category regen via `POST /kits/:id/regenerate` `{ section: "questions", category }` only — because API.md documents that shape; confirm dialog lists user/edited/pinned that merge will keep.
  - Flush pending debounced text ops before structural PATCH and before regenerate — because task requires flush-before-regen and version must match.
  - `409 VERSION_CONFLICT` opens reload/dismiss merge prompt (never silent adopt into overwrite) — because §6 / API.md return current kit on conflict.
  - Optimistic reorder with `@dnd-kit` PointerSensor + KeyboardSensor; pin/move/add/delete via documented PATCH ops; delete undo re-adds via `add` op — because server assigns new ids on add.
- Limitations / follow-ups: flashcards + schedule/brief regen UI are T23c; practice is T24; desktop only.

## 2026-09-25 T23c Builder — Flashcards + Schedule regen
- Changed: `apps/web/` (`KitFlashcardsSection`, `KitScheduleSection`, builder wiring, kit-builder helpers + tests, `regenerateKitBrief` / `regenerateKitSchedule` API client), root `README.md`, `.loop/progress-web.md`
- Decisions:
  - Flashcards CRUD via documented `PATCH` update/add/delete flashcard ops only — because API.md has no flashcard regenerate section; practice stays T24.
  - Schedule section is read-only + regenerate — because T25 owns richer day cards / coverage matrix; T23c only needs read + regen.
  - Flush pending brief/question/flashcard text ops before schedule or brief regen — because Verify requires schedule regen not clobber unrelated edits and version must match.
  - Brief regen confirm mirrors question keep rules (edited/yours listed) with optional `force` — because API skips edited briefs unless `force:true` and returns `briefSkipped`.
- Limitations / follow-ups: practice mode is T24; full schedule day cards + coverage matrix are T25; desktop only.

## 2026-09-25 T24 Practice mode
- Changed: `apps/web/` (`PracticeMode`, `/kits/[id]/practice`, practice helpers + tests, API client `getPracticeNext` / `getPracticeStats` / `submitPracticeReview`, builder Practice link), root `README.md`, `.loop/progress-web.md`
- Decisions:
  - Session queue is exactly `GET /kits/:id/practice/next` order — because API.md documents Leitner next-session ordering; client must not re-sort (§7).
  - Space/Enter reveal, then 1–5 → `POST /kits/:id/practice/review` — because task Verify is keyboard-only one session; buttons mirror the same actions.
  - Summary + coverage grid from `GET /kits/:id/practice/stats` after the queue finishes — because contract separates next vs stats; covered = reviewed flashcard requirement ids.
  - Practice lives at `/kits/:id/practice` with a builder header link — because T25 owns schedule/coverage matrix views; keep practice scoped to flashcards.
- Limitations / follow-ups: schedule day cards + requirements×questions matrix are T25; desktop only.

## 2026-09-25 T25 Schedule + coverage views
- Changed: `apps/web/` (`schedule-views` helpers + tests, `KitScheduleSection` day cards + Today marker, `CoverageMatrixSection`, builder wiring, question `#question-:id` anchors), root `README.md`, `.loop/progress-web.md`
- Decisions:
  - Interview date = local calendar day of kit `createdAt` + `schedule.days_available` — because SPEC says days-until-interview and API.md has no interview-date field; do not invent a PATCH.
  - Today marker = schedule day whose calendar date matches local today within the prep window (null outside) — because day 1 is the created date and day N is the last prep day before the interview date.
  - Day cards link question ids to `#question-:id` with prompt/category — because T25 asks for questions linked; hash anchors avoid inventing navigation routes.
  - Coverage matrix gaps use kit `coverage.uncovered_requirement_ids` only (not client recompute) — because §8 visibility must match pipeline coverage; Verify requires highlighting those ids.
- Limitations / follow-ups: desktop only; no Story Bank (T26); a11y/responsive pass is T27.

## 2026-09-25 Checkpoint C
- Changed: `.loop/checkpoint-c.md`, `.loop/TASKS.md` (C ticked), `.loop/PROMPT.md` (README-only-when-documentable — prior commit), `packages/core/src/deterministic/mergeRegenerated.test.ts` (moved-category + un-normalised dismissed)
- Decisions: **Keep Story Bank** (not Replan) — because it is an original idea, maps reusable STAR stories to requirement ids with deterministic overlap, and is demoable in the video. Live API used mongodb-memory-server when local mongod was down — because README still requires `MONGODB_URI` and the worker is in-process Express.
- Limitations / follow-ups: `PATCH` `baseVersion: 0` is 400 not 409 (`min(1)` in API.md); T26 Story Bank not started; did not re-run Checkpoint B evaluate


## 2026-09-25 Checkpoint C
- Changed: `.loop/checkpoint-c.md`, `.loop/TASKS.md` (C ticked), `.loop/PROMPT.md` (README-only-when-documentable — prior commit), `packages/core/src/deterministic/mergeRegenerated.test.ts` (moved-category + un-normalised dismissed)
- Decisions: **Keep Story Bank** (not Replan) — because it is an original idea, maps reusable STAR stories to requirement ids with deterministic overlap, and is demoable in the video. Live API used mongodb-memory-server when local mongod was down — because README still requires `MONGODB_URI` and the worker is in-process Express.
- Limitations / follow-ups: `PATCH` `baseVersion: 0` is 400 not 409 (`min(1)` in API.md); T26 Story Bank not started; did not re-run Checkpoint B evaluate

## 2026-09-25 T26 Story Bank
- Changed: `packages/core/src/deterministic/mapStories.ts` (+ tests), `apps/api` story-bank routes/store + `practice/next` hints, `apps/web` Story Bank section + practice hint, `docs/API.md`, `README.md`
- Decisions:
  - Mapping is stemmed keyword overlap in `deterministic/` (no LLM) — because the model must not assign coverage or citations; overlap is demoable (“no story for mentoring juniors”).
  - Stories persist on Kit `storyBank`, not Appendix A — because the kit schema stays exact; ids `s1`… assigned in code on PUT.
  - PUT does not bump kit `version` — because stories are independent of PATCH ops / regenerate concurrency.
  - Practice `hintStories` come from linked behavioural requirement matches, then card text — because T26 asks for a linked story hint on practice cards.
- Limitations / follow-ups: overlap is lexical (no synonyms); a11y/responsive pass is T27; empty STAR cards are omitted on save rather than stored as blanks.

## 2026-09-25 T27 A11y + responsive pass
- Changed: `apps/web/` (FocusTrapDialog, AppErrorBoundary, LoadingSkeleton, PHONE_LAYOUT tokens, keyboard checklist tests), root `README.md`, `.loop/TASKS.md`
- Decisions:
  - Shared `nextFocusIndex` + `FocusTrapDialog` for every confirm/conflict modal — because T27 requires Tab trap, Escape, and restore-focus; four copy-pasted backdrops would drift.
  - Keyboard checklist is a data table in `a11y.ts` covered by unit tests — because Verify asks for a keyboard-only walkthrough without adding a browser-driver dep.
  - 375px uses `px-4` gutters, wrapping toolbars, and `overflow-x-auto` tables — because SPEC §12 is laptop + phone; 375 is iPhone SE width and the named smoke target.
  - Loading skeletons keep `role="status"` `aria-live="polite"`; save status and job timeline already live-announce — because progress/save must be spoken without a visual-only spinner.
  - App-level ErrorBoundary in Providers — because §12 asks for error states on long-running generation and in-flight edits, not only inline alerts.
- Limitations / follow-ups: no automated axe/browser 375px screenshot (unit smoke + tokens only); Checkpoint D is the human phone + laptop keyboard run. Did not start T28 deploy.

## 2026-09-25 Checkpoint D
- Changed: `.loop/checkpoint-d.md` (ticked), `.loop/TASKS.md` (D `[x]`), middleware `/api` skip (`823c0c3`), question Up/Down + tap targets (`e1269a3`)
- Decisions: Walked locally with Playwright at 375px + keyboard instead of a physical phone — because Cursor browser tabs would not attach and no device was available; 375px had no horizontal overflow so D is ticked with that note. `/api/*` must not run the page auth guard — because a 307 to `/login` swallowed register/login Set-Cookie. Regen-while-unsaved and two-tab 409 UI both held during the walk.
- Limitations / follow-ups: physical iPhone not exercised; T28 has no live URL until Vercel/Render/Atlas logins.

## 2026-09-25 T28 Deploy config (partial)
- Changed: `render.yaml`, `apps/web/vercel.json`, `apps/api/src/index.ts` (`0.0.0.0` + 3 min timeout), `.env.example`, `README.md` production section
- Decisions: Vercel rewrites `/api/*` → `API_ORIGIN` (build-time); Render runs Express; Atlas M0; no CORS — because cookies stay first-party on the Next origin. Document Render sleep ~50s, `INTERRUPTED`, Secure cookies, regen timeout vs Vercel proxy — because those bite on free tiers. Did **not** tick T28 — no dashboard login, no live URL invented.
- Limitations / follow-ups: user must create Atlas cluster, Render web service, Vercel project, set secrets, rebuild web after API URL exists. Do not start T29 until T28 has a live URL.

## 2026-09-25 T28 live URL
- Changed: Vercel project `prep-kit` (root `apps/web`, `API_ORIGIN=https://prep-kit-fjgi.onrender.com` set before production build), `next`/`eslint-config-next` 15.2.6, prefer-const lint in `KitBriefRoleBuilder`, README live URL, TASKS T28 `[x]`
- Decisions: Tick T28 only after public Next login loaded and `GET /health` + `/api/health` rewrite returned `{ ok: true }` — because the task requires a working live stack, not config files. MongoDB MCP stays local `--readOnly` stdio — because it is not Atlas Admin and cannot provision M0; the human Atlas dashboard created M0. Vercel MCP stayed Unauthorized after `mcp_auth`; used logged-in Vercel CLI instead.
- Limitations / follow-ups: Vercel MCP account tools still Unauthorized; GitHub auto-deploy needs the Next 15.2.6 + lint fix or production will regress; Render free sleep still applies.



