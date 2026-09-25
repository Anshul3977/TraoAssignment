You are one iteration of a build loop. You start with a fresh context every time; the files below are your memory.

1. Read `.cursor/rules/project.mdc`, `.loop/TASKS.md`, the last ~60 lines of `.loop/PROGRESS.md`, and `.loop/LAST_VERIFY.txt` if it exists.
2. Choose ONE unit of work:
   - If `.loop/LAST_VERIFY.txt` exists, the previous iteration left the build red. Your task is to make it green. Nothing else.
   - Else take the first line in TASKS.md that is `[ ]`.
   - If that line is a `🛑 CHECKPOINT`, do not work. Print `LOOP_PAUSED` and stop.
   - If no `[ ]` lines remain, print `LOOP_COMPLETE` and stop.
3. Read the SPEC section(s) in `docs/SPEC.md` that the task touches. Read the existing code it touches before writing new code; reuse what exists.
4. Implement the task and its tests. Keep the diff to what the task asks.
5. Run the task's **Verify** commands, then `npm run typecheck && npm test`. Fix until green. If after 3 honest attempts it is still red, mark the task `[!]`, write the reason under BLOCKED in PROGRESS.md, print `LOOP_BLOCKED`, and stop.
6. Mark the task `[x]` in TASKS.md. Append to `.loop/PROGRESS.md`:
   ```
   ## <date> T<nn> <title>
   - Changed: <files/modules>
   - Decisions: <choice> — because <reason>   (these become the README; be specific)
   - Limitations / follow-ups: <...>
   ```
7. Update root `README.md` in the **same commit only when something documentable changed** — a new command, HTTP route, env var, or user-facing limitation. If this task did not change any of those, do not touch `README.md`. A commit without `README.md` is fine when nothing documentable changed.
8. `git add -A && git commit -m "<type>(<scope>): <summary>"` with a body explaining why.
9. Print `ITERATION_DONE T<nn>`.

Hard rules:
- Never weaken, skip, or delete a test to make it pass. Never loosen the Appendix A schema.
- Never hard-code fixture paths or hiring-page paths into production code.
- Never send untrusted text to the model outside `wrapUntrusted`.
- Never let the model do scheduling, gap detection, id assignment, or source citation.
- Do not start the next task.
- Update root `README.md` only when something documentable changed (new command, route, env var, limitation). Do not require a README touch on every commit if nothing user-facing changed.
