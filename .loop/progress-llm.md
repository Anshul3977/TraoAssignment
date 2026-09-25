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
