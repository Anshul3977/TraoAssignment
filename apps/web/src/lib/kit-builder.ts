/**
 * Pure helpers for the kit builder Brief + Role + Questions + Flashcards + Schedule UI
 * (T23a / T23b / T23c). Ops shapes match docs/API.md PATCH /kits/:id.
 */

import type {
  KitDocument,
  KitFlashcard,
  KitItemMeta,
  KitOp,
  KitQuestion,
  KitSchedule,
  QuestionCategory,
} from "./api";

/** Debounce before flushing local edits as a PATCH op batch. */
export const SAVE_DEBOUNCE_MS = 600;

export type SaveStatus = "saved" | "saving" | "offline";

export function saveStatusLabel(status: SaveStatus): string {
  switch (status) {
    case "saving":
      return "Saving…";
    case "offline":
      return "Offline";
    case "saved":
    default:
      return "Saved";
  }
}

export type OriginBadge = {
  key: string;
  label: string;
};

/**
 * Origin / edited / pinned badges (AI / Edited / Yours / Pinned).
 * Order: Edited → origin → Pinned.
 */
export function itemBadges(meta: KitItemMeta | undefined): OriginBadge[] {
  const badges: OriginBadge[] = [];
  if (!meta) return badges;
  if (meta.edited === true) {
    badges.push({ key: "edited", label: "Edited" });
  }
  const origin = typeof meta.origin === "string" ? meta.origin : undefined;
  if (origin === "user") {
    badges.push({ key: "yours", label: "Yours" });
  } else if (origin === "fallback") {
    badges.push({ key: "fallback", label: "Fallback" });
  } else if (origin === "generated") {
    badges.push({ key: "ai", label: "AI" });
  }
  if (meta.pinned === true) {
    badges.push({ key: "pinned", label: "Pinned" });
  }
  return badges;
}

/** Protected items survive category regeneration (API mergeRegenerated / §6). */
export function isProtectedQuestion(meta: KitItemMeta | undefined): boolean {
  if (!meta) return false;
  if (meta.origin === "user") return true;
  if (meta.edited === true) return true;
  if (meta.pinned === true) return true;
  return false;
}

/**
 * Brief regen is skipped when `company_brief.meta.edited` unless force=true
 * (docs/API.md). User-origin briefs are also treated as kept for the confirm UI.
 */
export function isProtectedBrief(meta: KitItemMeta | undefined): boolean {
  if (!meta) return false;
  if (meta.edited === true) return true;
  if (meta.origin === "user") return true;
  return false;
}

export const QUESTION_CATEGORIES: readonly QuestionCategory[] = [
  "technical",
  "behavioural",
  "system-design",
  "company-fit",
] as const;

export function categoryTabLabel(category: QuestionCategory): string {
  switch (category) {
    case "technical":
      return "Technical";
    case "behavioural":
      return "Behavioural";
    case "system-design":
      return "System design";
    case "company-fit":
      return "Company fit";
    default:
      return category;
  }
}

export function questionsInCategory(
  questions: readonly KitQuestion[],
  category: QuestionCategory,
): KitQuestion[] {
  return questions.filter((q) => q.category === category);
}

/**
 * Keyboard / 375px fallback for drag-and-drop: move `id` by `delta` in the
 * ordered id list. Returns null when the move is a no-op.
 */
export function shiftOrderedIds(
  ids: readonly string[],
  id: string,
  delta: number,
): string[] | null {
  const index = ids.indexOf(id);
  if (index < 0 || delta === 0) return null;
  const nextIndex = index + delta;
  if (nextIndex < 0 || nextIndex >= ids.length) return null;
  const next = [...ids];
  const [item] = next.splice(index, 1);
  if (!item) return null;
  next.splice(nextIndex, 0, item);
  return next;
}

/** Questions in this category that regenerate will keep (user / edited / pinned). */
export function questionsKeptOnRegen(
  questions: readonly KitQuestion[],
  category: QuestionCategory,
): KitQuestion[] {
  return questionsInCategory(questions, category).filter((q) =>
    isProtectedQuestion(q.meta),
  );
}

export function questionsReplacedOnRegen(
  questions: readonly KitQuestion[],
  category: QuestionCategory,
): KitQuestion[] {
  return questionsInCategory(questions, category).filter(
    (q) => !isProtectedQuestion(q.meta),
  );
}

export function isRequirementCovered(
  requirementId: string,
  uncoveredIds: readonly string[],
): boolean {
  return !uncoveredIds.includes(requirementId);
}

export type CoverageLabel = {
  covered: boolean;
  label: string;
};

export function coverageIndicator(
  requirementId: string,
  uncoveredIds: readonly string[],
): CoverageLabel {
  const covered = isRequirementCovered(requirementId, uncoveredIds);
  return {
    covered,
    label: covered ? "Covered" : "Uncovered",
  };
}

export type BriefDraft = {
  summary: string;
  what_they_do: string;
};

export type RequirementDraft = {
  id: string;
  text: string;
};

export type QuestionDraft = {
  id: string;
  prompt: string;
  answer_outline: string;
};

export type FlashcardDraft = {
  id: string;
  front: string;
  back: string;
};

/**
 * Diff local Brief + requirement text drafts against the last-saved kit
 * and build a PATCH ops array (coalesced; 1–100 ops).
 * Skips empty strings (API requires min length 1).
 */
export function buildBriefRoleOps(
  saved: KitDocument,
  brief: BriefDraft,
  requirements: readonly RequirementDraft[],
): KitOp[] {
  const ops: KitOp[] = [];

  const briefSet: { summary?: string; what_they_do?: string } = {};
  const nextSummary = brief.summary.trim();
  const nextWhat = brief.what_they_do.trim();
  if (
    nextSummary.length > 0 &&
    nextSummary !== saved.company_brief.summary
  ) {
    briefSet.summary = nextSummary;
  }
  if (
    nextWhat.length > 0 &&
    nextWhat !== saved.company_brief.what_they_do
  ) {
    briefSet.what_they_do = nextWhat;
  }
  if (briefSet.summary !== undefined || briefSet.what_they_do !== undefined) {
    ops.push({ op: "update", target: "brief", set: briefSet });
  }

  const byId = new Map(saved.role.requirements.map((r) => [r.id, r]));
  for (const draft of requirements) {
    const savedReq = byId.get(draft.id);
    if (!savedReq) continue;
    const nextText = draft.text.trim();
    if (nextText.length === 0) continue;
    if (nextText !== savedReq.text) {
      ops.push({
        op: "update",
        target: "requirement",
        id: draft.id,
        set: { text: nextText },
      });
    }
  }

  return ops;
}

/**
 * Diff question prompt/outline drafts against saved kit → update ops.
 * Skips empty strings (API min length 1).
 */
export function buildQuestionTextOps(
  saved: KitDocument,
  drafts: readonly QuestionDraft[],
): KitOp[] {
  const ops: KitOp[] = [];
  const byId = new Map(saved.questions.map((q) => [q.id, q]));
  for (const draft of drafts) {
    const savedQ = byId.get(draft.id);
    if (!savedQ) continue;
    const set: {
      prompt?: string;
      answer_outline?: string;
    } = {};
    const nextPrompt = draft.prompt.trim();
    const nextOutline = draft.answer_outline.trim();
    if (nextPrompt.length > 0 && nextPrompt !== savedQ.prompt) {
      set.prompt = nextPrompt;
    }
    if (nextOutline.length > 0 && nextOutline !== savedQ.answer_outline) {
      set.answer_outline = nextOutline;
    }
    if (set.prompt !== undefined || set.answer_outline !== undefined) {
      ops.push({ op: "update", target: "question", id: draft.id, set });
    }
  }
  return ops;
}

/**
 * Diff flashcard front/back drafts against saved kit → update ops.
 * Skips empty strings (API min length 1).
 */
export function buildFlashcardTextOps(
  saved: KitDocument,
  drafts: readonly FlashcardDraft[],
): KitOp[] {
  const ops: KitOp[] = [];
  const byId = new Map(saved.flashcards.map((f) => [f.id, f]));
  for (const draft of drafts) {
    const savedF = byId.get(draft.id);
    if (!savedF) continue;
    const set: { front?: string; back?: string } = {};
    const nextFront = draft.front.trim();
    const nextBack = draft.back.trim();
    if (nextFront.length > 0 && nextFront !== savedF.front) {
      set.front = nextFront;
    }
    if (nextBack.length > 0 && nextBack !== savedF.back) {
      set.back = nextBack;
    }
    if (set.front !== undefined || set.back !== undefined) {
      ops.push({ op: "update", target: "flashcard", id: draft.id, set });
    }
  }
  return ops;
}

/** Combine brief/role + question + flashcard text ops for a single debounced flush. */
export function buildPendingTextOps(
  saved: KitDocument,
  brief: BriefDraft,
  requirements: readonly RequirementDraft[],
  questionDrafts: readonly QuestionDraft[],
  flashcardDrafts: readonly FlashcardDraft[] = [],
): KitOp[] {
  return [
    ...buildBriefRoleOps(saved, brief, requirements),
    ...buildQuestionTextOps(saved, questionDrafts),
    ...buildFlashcardTextOps(saved, flashcardDrafts),
  ];
}

export function draftsFromKit(kit: KitDocument): {
  brief: BriefDraft;
  requirements: RequirementDraft[];
  questions: QuestionDraft[];
  flashcards: FlashcardDraft[];
} {
  return {
    brief: {
      summary: kit.company_brief.summary,
      what_they_do: kit.company_brief.what_they_do,
    },
    requirements: kit.role.requirements.map((r) => ({
      id: r.id,
      text: r.text,
    })),
    questions: kit.questions.map((q) => ({
      id: q.id,
      prompt: q.prompt,
      answer_outline: q.answer_outline,
    })),
    flashcards: kit.flashcards.map((f) => ({
      id: f.id,
      front: f.front,
      back: f.back,
    })),
  };
}

/** Read-only schedule summary for the builder (T23c; full day cards are T25). */
export function scheduleSummary(schedule: KitSchedule | undefined | null): {
  daysAvailable: number;
  dayCount: number;
  totalMinutes: number;
} {
  const days = schedule?.days ?? [];
  return {
    daysAvailable: schedule?.days_available ?? 0,
    dayCount: days.length,
    totalMinutes: days.reduce((sum, d) => sum + (d.minutes || 0), 0),
  };
}

/** Optimistic local remove of a flashcard (structural delete). */
export function removeFlashcard(
  flashcards: readonly KitFlashcard[],
  id: string,
): KitFlashcard[] {
  return flashcards.filter((f) => f.id !== id);
}

/** Optimistic reorder of ids within a category; returns new full questions array. */
export function reorderQuestionsInCategory(
  questions: readonly KitQuestion[],
  category: QuestionCategory,
  fromId: string,
  toId: string,
): KitQuestion[] {
  const inCat = questions.filter((q) => q.category === category);
  const fromIndex = inCat.findIndex((q) => q.id === fromId);
  const toIndex = inCat.findIndex((q) => q.id === toId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return [...questions];
  }
  const nextInCat = [...inCat];
  const [moved] = nextInCat.splice(fromIndex, 1);
  nextInCat.splice(toIndex, 0, moved!);
  const result: KitQuestion[] = [];
  let catInserted = false;
  for (const q of questions) {
    if (q.category === category) {
      if (!catInserted) {
        result.push(...nextInCat);
        catInserted = true;
      }
    } else {
      result.push(q);
    }
  }
  if (!catInserted) result.push(...nextInCat);
  return result;
}

export function moveQuestionCategory(
  questions: readonly KitQuestion[],
  id: string,
  category: QuestionCategory,
): KitQuestion[] {
  return questions.map((q) => (q.id === id ? { ...q, category } : q));
}

export function setQuestionPinned(
  questions: readonly KitQuestion[],
  id: string,
  pinned: boolean,
): KitQuestion[] {
  return questions.map((q) => {
    if (q.id !== id) return q;
    return {
      ...q,
      meta: { ...q.meta, pinned },
    };
  });
}

export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  ) {
    const msg = (err as { message: string }).message.toLowerCase();
    return (
      msg.includes("failed to fetch") ||
      msg.includes("networkerror") ||
      msg.includes("network request failed")
    );
  }
  return false;
}
