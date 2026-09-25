import type { Question, Requirement } from "../schema/kit.js";

/** Minimal requirement fields needed for coverage checking. */
export type GapRequirement = Pick<Requirement, "id" | "priority">;

/** Minimal question fields needed for coverage checking. */
export type GapQuestion = Pick<Question, "requirement_ids">;

/**
 * Return requirement ids with no covering question, must-gaps before nice-gaps.
 * Within the same priority, order matches the input requirements array.
 * Pure — no LLM (§3 / §4).
 */
export function findGaps(
  requirements: GapRequirement[],
  questions: GapQuestion[],
): string[] {
  const covered = new Set<string>();
  for (const q of questions) {
    for (const rid of q.requirement_ids) {
      covered.add(rid);
    }
  }

  const uncovered = requirements.filter((r) => !covered.has(r.id));
  const must = uncovered
    .filter((r) => r.priority === "must")
    .map((r) => r.id);
  const nice = uncovered
    .filter((r) => r.priority === "nice")
    .map((r) => r.id);
  return [...must, ...nice];
}
