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
