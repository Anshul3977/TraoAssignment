# PROGRESS — llm lane (append-only)

## BLOCKED
(none)


## 2026-09-25 T08a LLM providers + limiter
- Changed: `packages/core/src/llm/` — `types`, `errors`, `limiter` (sliding TPM+RPM, chars/4), `retry` (backoff+jitter, Retry-After / retryDelay), `gemini` (REST JSON mode), `groq` (OpenAI-compatible REST), `config` (env), `client` (limiter → retry ≤6 → fallback), `index` + tests (`limiter`, `client`, `providers`)
- Decisions: one process-wide `TokenRequestLimiter` shared by primary and fallback — because batch concurrency must not stampede free-tier RPM/TPM; fake `LlmProvider` injection for verify tests — because real keys must never appear in CI; default limiter 15 RPM / 250k TPM — conservative Gemini free-tier headroom (overridable via `getSharedLimiter` / `setSharedLimiter`)
- Limitations / follow-ups: did **not** re-export from `packages/core/src/index.ts` (outside owned folder) — consumers import `@prep/core` path or wait for a later wiring task; `.env.example` already documents `LLM_PROVIDER`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GROQ_API_KEY`, `GROQ_MODEL` (not edited; root is outside owned folder); worktree lacked `.loop/PROMPT.md` / `docs/SPEC.md` / `.cursor/rules/project.mdc` — followed copies from the main tree for this iteration only; TASKS.md left unmarked per lane override (orchestrator ticks `[x]`)
