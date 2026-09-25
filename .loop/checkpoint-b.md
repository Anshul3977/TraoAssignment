# Checkpoint B — fixture + real-company review

Date: 2026-09-25  
Branch: `main` (T16 at `e735bbe`). T17a not started.

## Checkpoint A skip check (facts)

`git log --oneline -15` shows **T15 before T16**:

- `b3bf591` `feat(core): orchestrate runPipeline across retrieval and LLM steps` (T15)
- `e735bbe` `feat(cli): batch evaluate with Appendix B output` (T16)

So a `runPipeline` commit **does exist before** `e735bbe`. History was not rewritten.

Batch CLI wiring:

- `packages/core/src/cli/runBatch.ts` imports `runPipeline` from `../pipeline.js` and defaults `runCase = runPipeline`.
- `packages/core/src/cli/evaluate.ts` documents sharing `runPipeline` with the API and calls `runBatch`.

**Verdict:** the loop did **not** skip Checkpoint A’s T15 `runPipeline` commit; evaluate/batch use the same `runPipeline` as the app.

## Missing-key behaviour

Commit `38b7929` `fix(cli): warn when the LLM key is missing`:

- Startup `WARNING` via `warnIfLlmNotConfigured`
- Case error code `LLM_NOT_CONFIGURED` (not generic `CASE_FAILED`)
- Tests cover warning + batch mapping

## Timings (fixtures / `npm run evaluate`)

| Run | Output | Elapsed | Result |
|---|---|---|---|
| run1 | `out/kits-run1.json` | **506.3 s** (~8.4 min) | 5/5 ok (under 12 min) |
| run2 | `out/kits-run2.json` | **16.3 s** | 5/5 ok (LLM disk cache) |
| final (after fixes) | `out/kits-final.json` / `out/kits.json` | **19.7 s** | 5/5 ok |

`npm run fixtures` on :8099 for all local cases. Measured with `Stopwatch` / `WaitForExit` (no Unix `time`).

Earlier attempts hit retired `gemini-2.0-flash` (404) and free-tier **daily** caps on `gemini-2.5-flash` (20 req/day). Default model moved to `gemini-flash-lite-latest`; CLI evaluate uses concurrency **1** + 8 RPM limiter + 8 min case timeout.

## Must/nice side-by-side (run1 vs run2)

Labels were **stable** across the two checkpoint runs (identical strings). After later grounding fixes, **final** re-labels stub `preferred` → nice and `Familiarity with REST APIs` → nice:

| Case | run1 / run2 | final (post-fix) |
|---|---|---|
| case-01 / case-05 | 4 must + 3 nice (exact expected) | same |
| case-02 | must: Node preferred; must: Postgres preferred | **nice** / **nice** |
| case-03 | 3 must + 1 nice | same |
| case-04 | 2 must | must TS; **nice** Familiarity with REST APIs |

Temperature set to **0** on Gemini/Groq providers; rule-based cues (evidence/text → JD section → LLM section) decide must/nice. Tests in `groundRequirements.test.ts` / `providers.test.ts`.

## Fixture judgment table

| Criterion | Pass/Fail | Reason |
|---|---|---|
| Rich JD, acme | **PASS** | Must/nice match `fixtures/expected/case-01-requirements.json` (7/7, 0 extra, 0 mislabels). Hiring page found. Interview process includes take-home + system-design; questions include take-home debrief + system-design categories. |
| Two-line stub | **PASS** | 2 grounded lines from the JD, `notes.thin_jd=true`, no invented padding. After cue fix, both are **nice** (`preferred`). |
| quietco brief | **PASS** | Summary states there is **no about page or careers page**; interview_process `found:false`; no fabricated history. |
| evil / COBOL | **PASS** | “Knows COBOL” / COBOL absent from requirements, brief, and kit JSON. |
| Unreachable URL | **PASS** | `status=ok` with honest empty brief + `research_log.company_unreachable=true` (matches README: unreachable ≠ failed). |
| 1 day and 60 days | **PASS** | case-01: 1 day; case-05: 60 days; no empty days; integer minutes on final kits. |

## Real companies (`fixtures/cases-real.json` → `out/kits-real.json`)

Elapsed **124 s**, both ok.

| Company | Hiring pages | pages_used | Notes |
|---|---|---|---|
| PostHog (`posthog.com`) | 8 | 15 | Brief describes product/remote culture; hiring crawl succeeded. |
| GitLab (`about.gitlab.com`) | 2 | 12 | Brief includes founding/all-remote DevSecOps framing; 2 nice gaps left uncovered (`r5`,`r6`) — acceptable per nice-gap policy. |

Honesty/hiring: both found hiring pages. No COBOL. Real sites are noisier than fixtures (marketing copy in briefs) but not fabricated from nothing.

## Fixes landed during Checkpoint B (each with tests + README)

- `38b7929` missing LLM key → `LLM_NOT_CONFIGURED` + warning  
- `aa507f2` / `acfd8de` working Gemini default + temperature 0  
- `a36ccc4` / `7e6746e` longer case timeout + serial evaluate under free-tier RPM  
- `ddf4aa2` / `8bc3ffa` JD/evidence must/nice cues; strip false no-hiring claims  
- `e6d2870` honest about/hiring gaps on briefs  
- `7f1d711` empty-bank question fallbacks (no all-empty schedules)

Review helper: `npx tsx scripts/review-kits.ts out/kits.json`

## Checkpoint B status

Marked **[x]** in `.loop/TASKS.md` because the fixture judgment table above all **PASS** on the final evaluate (`out/kits-final.json`).

**T17a was not started.**
