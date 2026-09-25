import type { Kit, Question, Requirement } from "../schema/kit.js";
import { findGaps } from "./findGaps.js";

/** Origins used on questions / flashcards (T19b meta). */
export type ItemOrigin = "generated" | "user" | "fallback";

export type RegenerateSection = "brief" | "schedule" | "questions";

export type KitNextIds = {
  question?: number;
  flashcard?: number;
  requirement?: number;
};

/** Kit-level meta extensions used by merge / edit / regenerate. */
export type KitMergeMeta = {
  next_ids?: KitNextIds;
  dismissed?: string[];
  version?: number;
  [key: string]: unknown;
};

export type MergeRegeneratedInput = {
  kit: Kit;
  section: RegenerateSection;
  /** Required when `section === "questions"`. */
  category?: Question["category"];
  /** When regenerating brief, override `company_brief.meta.edited`. */
  force?: boolean;
  /** Candidate brief from the LLM (section `brief`). */
  brief?: Kit["company_brief"];
  /**
   * Candidate questions for the target category (section `questions`).
   * Ids on candidates are ignored — fresh ids come from `meta.next_ids`.
   */
  questions?: Question[];
  /** Replacement schedule (section `schedule`), or seed when no realloc hook. */
  schedule?: Kit["schedule"];
  /**
   * Called when questions change so schedule `question_ids` stay valid.
   * API / pipeline typically wraps `allocateSchedule`.
   */
  reallocateSchedule?: (kit: Kit) => Kit["schedule"];
};

export type MergeRegeneratedResult = {
  kit: Kit;
  /** True when brief regen was skipped because edited && !force. */
  briefSkipped: boolean;
  /** True when the questions array changed. */
  questionsChanged: boolean;
};

type LooseMeta = Record<string, unknown> | undefined;

function asRecord(meta: LooseMeta): Record<string, unknown> {
  return meta && typeof meta === "object" ? { ...meta } : {};
}

/**
 * Protected items survive category regeneration (§6):
 * user-written, user-edited, or pinned.
 */
export function isProtectedItem(meta: LooseMeta): boolean {
  const m = asRecord(meta);
  if (m.origin === "user") return true;
  if (m.edited === true) return true;
  if (m.pinned === true) return true;
  return false;
}

/** Collapse whitespace + lowercase for dismissed-prompt matching. */
export function normalisePrompt(prompt: string): string {
  return prompt.trim().toLowerCase().replace(/\s+/g, " ");
}

function readKitMeta(kit: Kit): KitMergeMeta {
  return asRecord(kit.meta) as KitMergeMeta;
}

function dismissedSet(meta: KitMergeMeta): Set<string> {
  const list = Array.isArray(meta.dismissed) ? meta.dismissed : [];
  return new Set(
    list.filter((x): x is string => typeof x === "string").map(normalisePrompt),
  );
}

/** Map requirement kind → question category for gap fallbacks (T12b). */
export function categoryForRequirementKind(
  kind: Requirement["kind"],
): Question["category"] | null {
  if (kind === "technical" || kind === "domain") return "technical";
  if (kind === "behavioural") return "behavioural";
  return null;
}

function parseNumericId(id: string, prefix: string): number | null {
  if (!id.startsWith(prefix)) return null;
  const n = Number(id.slice(prefix.length));
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function maxQuestionNumber(questions: Question[]): number {
  let max = 0;
  for (const q of questions) {
    const n = parseNumericId(q.id, "q");
    if (n !== null && n > max) max = n;
  }
  return max;
}

function nextQuestionCounter(
  meta: KitMergeMeta,
  questions: Question[],
): number {
  const fromMeta = meta.next_ids?.question;
  const fromIds = maxQuestionNumber(questions) + 1;
  if (typeof fromMeta === "number" && Number.isInteger(fromMeta) && fromMeta > 0) {
    return Math.max(fromMeta, fromIds);
  }
  return fromIds;
}

function allocateQuestionId(
  counter: { value: number },
): string {
  const id = `q${counter.value}`;
  counter.value += 1;
  return id;
}

function withNextIds(kit: Kit, questionNext: number): Kit {
  const meta = readKitMeta(kit);
  const next_ids: KitNextIds = {
    ...(meta.next_ids ?? {}),
    question: questionNext,
  };
  return {
    ...kit,
    meta: { ...meta, next_ids },
  };
}

function pruneScheduleQuestionIds(
  schedule: Kit["schedule"],
  validIds: Set<string>,
): Kit["schedule"] {
  return {
    ...schedule,
    days: schedule.days.map((d) => ({
      ...d,
      question_ids: d.question_ids.filter((id) => validIds.has(id)),
    })),
  };
}

function makeFallbackQuestion(
  req: Requirement,
  category: Question["category"],
  id: string,
): Question {
  return {
    id,
    requirement_ids: [req.id],
    category,
    prompt: `Prepare to discuss: ${req.text}`,
    answer_outline: `Cover the must-have requirement "${req.text}" with a concrete example.`,
    difficulty: 2,
    meta: { origin: "fallback" as ItemOrigin, edited: false, pinned: false },
  };
}

/**
 * After merging a category, close remaining must-gaps that belong to that
 * category with deterministic fallback questions (§4 / T19a).
 */
function appendFallbackForCategory(
  kit: Kit,
  category: Question["category"],
  counter: { value: number },
): { questions: Question[]; uncovered: string[] } {
  const requirements = kit.role.requirements;
  const uncovered = findGaps(requirements, kit.questions);
  const reqById = new Map(requirements.map((r) => [r.id, r]));
  const extras: Question[] = [];

  for (const rid of uncovered) {
    const req = reqById.get(rid);
    if (!req || req.priority !== "must") continue;
    if (categoryForRequirementKind(req.kind) !== category) continue;
    extras.push(makeFallbackQuestion(req, category, allocateQuestionId(counter)));
  }

  const questions = extras.length > 0 ? [...kit.questions, ...extras] : kit.questions;
  const uncoveredAfter = findGaps(requirements, questions);
  return { questions, uncovered: uncoveredAfter };
}

function mergeQuestions(
  kit: Kit,
  category: Question["category"],
  candidates: Question[],
): { kit: Kit; questionsChanged: boolean } {
  const meta = readKitMeta(kit);
  const dismissed = dismissedSet(meta);
  const counter = { value: nextQuestionCounter(meta, kit.questions) };

  const kept: Question[] = [];
  let removedGenerated = false;

  for (const q of kit.questions) {
    if (q.category !== category) {
      kept.push(q);
      continue;
    }
    if (isProtectedItem(q.meta)) {
      kept.push(q);
      continue;
    }
    removedGenerated = true;
  }

  const incoming: Question[] = [];
  for (const raw of candidates) {
    if (dismissed.has(normalisePrompt(raw.prompt))) continue;
    const id = allocateQuestionId(counter);
    incoming.push({
      ...raw,
      id,
      category,
      meta: {
        ...asRecord(raw.meta),
        origin: (asRecord(raw.meta).origin as ItemOrigin | undefined) ?? "generated",
        edited: false,
        pinned: false,
      },
    });
  }

  let questions = [...kept, ...incoming];
  let working: Kit = {
    ...kit,
    questions,
    meta: {
      ...meta,
      next_ids: { ...(meta.next_ids ?? {}), question: counter.value },
    },
  };

  const fallback = appendFallbackForCategory(working, category, counter);
  questions = fallback.questions;
  working = {
    ...working,
    questions,
    coverage: {
      ...working.coverage,
      uncovered_requirement_ids: fallback.uncovered,
    },
    meta: {
      ...readKitMeta(working),
      next_ids: {
        ...(readKitMeta(working).next_ids ?? {}),
        question: counter.value,
      },
    },
  };

  const questionsChanged =
    removedGenerated ||
    incoming.length > 0 ||
    fallback.questions.length !== kit.questions.length ||
    questions.map((q) => q.id).join(",") !== kit.questions.map((q) => q.id).join(",");

  return { kit: working, questionsChanged };
}

function applyScheduleAfterQuestionChange(
  kit: Kit,
  reallocateSchedule?: (kit: Kit) => Kit["schedule"],
): Kit {
  if (reallocateSchedule) {
    const schedule = reallocateSchedule(kit);
    return { ...kit, schedule };
  }
  const valid = new Set(kit.questions.map((q) => q.id));
  return {
    ...kit,
    schedule: pruneScheduleQuestionIds(kit.schedule, valid),
  };
}

/**
 * Merge a regenerated section into an existing kit without clobbering
 * user / edited / pinned work (§6). Pure — no LLM.
 */
export function mergeRegenerated(
  input: MergeRegeneratedInput,
): MergeRegeneratedResult {
  const { kit, section, force = false } = input;
  let briefSkipped = false;
  let questionsChanged = false;
  let next = kit;

  if (section === "brief") {
    const briefMeta = asRecord(kit.company_brief.meta);
    if (briefMeta.edited === true && !force) {
      briefSkipped = true;
    } else if (input.brief) {
      next = {
        ...next,
        company_brief: {
          ...input.brief,
          meta: {
            ...asRecord(input.brief.meta),
            edited: false,
          },
        },
      };
    }
  } else if (section === "schedule") {
    if (input.schedule) {
      next = { ...next, schedule: input.schedule };
    } else if (input.reallocateSchedule) {
      next = { ...next, schedule: input.reallocateSchedule(next) };
    }
  } else if (section === "questions") {
    if (!input.category) {
      throw new Error('mergeRegenerated: category is required when section is "questions"');
    }
    const merged = mergeQuestions(next, input.category, input.questions ?? []);
    next = merged.kit;
    questionsChanged = merged.questionsChanged;
    if (questionsChanged) {
      next = applyScheduleAfterQuestionChange(next, input.reallocateSchedule);
    }
  }

  // Ensure next_ids stays ahead of any ids present after merge.
  const meta = readKitMeta(next);
  const questionNext = nextQuestionCounter(meta, next.questions);
  next = withNextIds(next, questionNext);

  return { kit: next, briefSkipped, questionsChanged };
}
