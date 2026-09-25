import type { ZodIssue } from "zod";
import { KitSchema, type Kit } from "./kit.js";

export type ValidationIssue = {
  /** Dot/bracket path, e.g. `questions[0].requirement_ids[1]`. */
  path: string;
  message: string;
};

export type ValidateKitResult =
  | { ok: true; kit: Kit }
  | { ok: false; issues: ValidationIssue[] };

function formatPath(path: PropertyKey[]): string {
  if (path.length === 0) return "(root)";
  let out = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      out += `[${segment}]`;
    } else if (out === "") {
      out = String(segment);
    } else {
      out += `.${String(segment)}`;
    }
  }
  return out;
}

function zodIssuesToValidation(issues: ZodIssue[]): ValidationIssue[] {
  return issues.map((issue) => ({
    path: formatPath(issue.path),
    message: issue.message,
  }));
}

function findDuplicateIds(
  items: { id: string }[],
  collectionPath: string,
): ValidationIssue[] {
  const seen = new Map<string, number>();
  const issues: ValidationIssue[] = [];
  for (let i = 0; i < items.length; i++) {
    const id = items[i]!.id;
    const prev = seen.get(id);
    if (prev !== undefined) {
      issues.push({
        path: `${collectionPath}[${i}].id`,
        message: `duplicate id "${id}" (also at ${collectionPath}[${prev}].id)`,
      });
    } else {
      seen.set(id, i);
    }
  }
  return issues;
}

/**
 * Parse Appendix A shape (zod) then enforce cross-refs:
 * unique ids, requirement_ids / schedule question_ids exist,
 * days.length === days_available, minutes ≥ 0 int, difficulty ∈ {1,2,3}.
 */
export function validateKit(input: unknown): ValidateKitResult {
  const parsed = KitSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, issues: zodIssuesToValidation(parsed.error.issues) };
  }

  const kit = parsed.data;
  const issues: ValidationIssue[] = [];

  issues.push(...findDuplicateIds(kit.role.requirements, "role.requirements"));
  issues.push(...findDuplicateIds(kit.questions, "questions"));
  issues.push(...findDuplicateIds(kit.flashcards, "flashcards"));

  const requirementIds = new Set(kit.role.requirements.map((r) => r.id));
  const questionIds = new Set(kit.questions.map((q) => q.id));

  for (let qi = 0; qi < kit.questions.length; qi++) {
    const q = kit.questions[qi]!;
    for (let ri = 0; ri < q.requirement_ids.length; ri++) {
      const rid = q.requirement_ids[ri]!;
      if (!requirementIds.has(rid)) {
        issues.push({
          path: `questions[${qi}].requirement_ids[${ri}]`,
          message: `unknown requirement id "${rid}"`,
        });
      }
    }
  }

  for (let fi = 0; fi < kit.flashcards.length; fi++) {
    const f = kit.flashcards[fi]!;
    for (let ri = 0; ri < f.requirement_ids.length; ri++) {
      const rid = f.requirement_ids[ri]!;
      if (!requirementIds.has(rid)) {
        issues.push({
          path: `flashcards[${fi}].requirement_ids[${ri}]`,
          message: `unknown requirement id "${rid}"`,
        });
      }
    }
  }

  if (kit.schedule.days.length !== kit.schedule.days_available) {
    issues.push({
      path: "schedule.days",
      message: `days.length (${kit.schedule.days.length}) must equal days_available (${kit.schedule.days_available})`,
    });
  }

  for (let di = 0; di < kit.schedule.days.length; di++) {
    const day = kit.schedule.days[di]!;
    for (let qi = 0; qi < day.question_ids.length; qi++) {
      const qid = day.question_ids[qi]!;
      if (!questionIds.has(qid)) {
        issues.push({
          path: `schedule.days[${di}].question_ids[${qi}]`,
          message: `unknown question id "${qid}"`,
        });
      }
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, kit };
}
