import type { Kit } from "@prep/core";
import { normalisePrompt, type Flashcard, type Question } from "../lib/prepCore.js";
import type { KitOp } from "./opsSchema.js";

export class ApplyOpsError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ApplyOpsError";
    this.code = code;
  }
}

type KitMeta = {
  next_ids?: {
    question?: number;
    flashcard?: number;
    requirement?: number;
  };
  dismissed?: string[];
  [key: string]: unknown;
};

function asMeta(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === "object" ? { ...meta } : {};
}

function readKitMeta(kit: Kit): KitMeta {
  return asMeta(kit.meta) as KitMeta;
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseNumericId(id: string, prefix: string): number | null {
  if (!id.startsWith(prefix)) return null;
  const n = Number(id.slice(prefix.length));
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function nextCounter(
  metaValue: number | undefined,
  existingIds: string[],
  prefix: string,
): number {
  let max = 0;
  for (const id of existingIds) {
    const n = parseNumericId(id, prefix);
    if (n !== null && n > max) max = n;
  }
  const fromIds = max + 1;
  if (
    typeof metaValue === "number" &&
    Number.isInteger(metaValue) &&
    metaValue > 0
  ) {
    return Math.max(metaValue, fromIds);
  }
  return fromIds;
}

function withKitMeta(kit: Kit, meta: KitMeta): Kit {
  return { ...kit, meta };
}

function pruneSchedule(kit: Kit): Kit {
  const valid = new Set(kit.questions.map((q) => q.id));
  return {
    ...kit,
    schedule: {
      ...kit.schedule,
      days: kit.schedule.days.map((d) => ({
        ...d,
        question_ids: d.question_ids.filter((id) => valid.has(id)),
      })),
    },
  };
}

function contentEdited(meta: Record<string, unknown>): Record<string, unknown> {
  return {
    ...meta,
    edited: true,
    updated_at: nowIso(),
  };
}

function applyOne(kit: Kit, op: KitOp): Kit {
  switch (op.op) {
    case "update":
      return applyUpdate(kit, op);
    case "add":
      return applyAdd(kit, op);
    case "delete":
      return applyDelete(kit, op);
    case "reorder":
      return applyReorder(kit, op);
    case "move":
      return applyMove(kit, op);
    default: {
      const _exhaustive: never = op;
      return _exhaustive;
    }
  }
}

function applyUpdate(kit: Kit, op: Extract<KitOp, { op: "update" }>): Kit {
  if (op.target === "brief") {
    const briefMeta = contentEdited(asMeta(kit.company_brief.meta));
    return {
      ...kit,
      company_brief: {
        ...kit.company_brief,
        ...(op.set.summary !== undefined ? { summary: op.set.summary } : {}),
        ...(op.set.what_they_do !== undefined
          ? { what_they_do: op.set.what_they_do }
          : {}),
        meta: briefMeta,
      },
    };
  }

  if (op.target === "requirement") {
    const idx = kit.role.requirements.findIndex((r) => r.id === op.id);
    if (idx < 0) {
      throw new ApplyOpsError("NOT_FOUND", `Requirement ${op.id} not found.`);
    }
    const req = kit.role.requirements[idx]!;
    const requirements = [...kit.role.requirements];
    requirements[idx] = {
      ...req,
      ...(op.set.text !== undefined ? { text: op.set.text } : {}),
      ...(op.set.priority !== undefined ? { priority: op.set.priority } : {}),
      ...(op.set.kind !== undefined ? { kind: op.set.kind } : {}),
      meta: contentEdited(asMeta(req.meta)),
    };
    return { ...kit, role: { ...kit.role, requirements } };
  }

  if (op.target === "question") {
    const idx = kit.questions.findIndex((q) => q.id === op.id);
    if (idx < 0) {
      throw new ApplyOpsError("NOT_FOUND", `Question ${op.id} not found.`);
    }
    const q = kit.questions[idx]!;
    const meta = asMeta(q.meta);
    const contentTouched =
      op.set.prompt !== undefined ||
      op.set.answer_outline !== undefined ||
      op.set.difficulty !== undefined ||
      op.set.requirement_ids !== undefined;
    const nextMeta = {
      ...meta,
      ...(op.set.pinned !== undefined ? { pinned: op.set.pinned } : {}),
      ...(contentTouched
        ? { edited: true, updated_at: nowIso() }
        : op.set.pinned !== undefined
          ? { updated_at: nowIso() }
          : {}),
    };
    const questions = [...kit.questions];
    questions[idx] = {
      ...q,
      ...(op.set.prompt !== undefined ? { prompt: op.set.prompt } : {}),
      ...(op.set.answer_outline !== undefined
        ? { answer_outline: op.set.answer_outline }
        : {}),
      ...(op.set.difficulty !== undefined
        ? { difficulty: op.set.difficulty }
        : {}),
      ...(op.set.requirement_ids !== undefined
        ? { requirement_ids: op.set.requirement_ids }
        : {}),
      meta: nextMeta,
    };
    return { ...kit, questions };
  }

  // flashcard
  const idx = kit.flashcards.findIndex((f) => f.id === op.id);
  if (idx < 0) {
    throw new ApplyOpsError("NOT_FOUND", `Flashcard ${op.id} not found.`);
  }
  const card = kit.flashcards[idx]!;
  const meta = asMeta(card.meta);
  const contentTouched =
    op.set.front !== undefined ||
    op.set.back !== undefined ||
    op.set.requirement_ids !== undefined;
  const nextMeta = {
    ...meta,
    ...(op.set.pinned !== undefined ? { pinned: op.set.pinned } : {}),
    ...(contentTouched
      ? { edited: true, updated_at: nowIso() }
      : op.set.pinned !== undefined
        ? { updated_at: nowIso() }
        : {}),
  };
  const flashcards = [...kit.flashcards];
  flashcards[idx] = {
    ...card,
    ...(op.set.front !== undefined ? { front: op.set.front } : {}),
    ...(op.set.back !== undefined ? { back: op.set.back } : {}),
    ...(op.set.requirement_ids !== undefined
      ? { requirement_ids: op.set.requirement_ids }
      : {}),
    meta: nextMeta,
  };
  return { ...kit, flashcards };
}

function applyAdd(kit: Kit, op: Extract<KitOp, { op: "add" }>): Kit {
  const kitMeta = readKitMeta(kit);
  if (op.target === "question") {
    const counter = nextCounter(
      kitMeta.next_ids?.question,
      kit.questions.map((q) => q.id),
      "q",
    );
    const id = `q${counter}`;
    const question: Question = {
      id,
      prompt: op.value.prompt,
      answer_outline: op.value.answer_outline,
      category: op.value.category,
      difficulty: op.value.difficulty,
      requirement_ids: op.value.requirement_ids,
      meta: {
        origin: "user",
        edited: false,
        pinned: false,
        updated_at: nowIso(),
      },
    };
    return withKitMeta(
      { ...kit, questions: [...kit.questions, question] },
      {
        ...kitMeta,
        next_ids: { ...(kitMeta.next_ids ?? {}), question: counter + 1 },
      },
    );
  }

  const counter = nextCounter(
    kitMeta.next_ids?.flashcard,
    kit.flashcards.map((f) => f.id),
    "f",
  );
  const id = `f${counter}`;
  const flashcard: Flashcard = {
    id,
    front: op.value.front,
    back: op.value.back,
    requirement_ids: op.value.requirement_ids,
    meta: {
      origin: "user",
      edited: false,
      pinned: false,
      updated_at: nowIso(),
    },
  };
  return withKitMeta(
    { ...kit, flashcards: [...kit.flashcards, flashcard] },
    {
      ...kitMeta,
      next_ids: { ...(kitMeta.next_ids ?? {}), flashcard: counter + 1 },
    },
  );
}

function applyDelete(kit: Kit, op: Extract<KitOp, { op: "delete" }>): Kit {
  if (op.target === "question") {
    const q = kit.questions.find((x) => x.id === op.id);
    if (!q) {
      throw new ApplyOpsError("NOT_FOUND", `Question ${op.id} not found.`);
    }
    const origin = asMeta(q.meta).origin;
    const questions = kit.questions.filter((x) => x.id !== op.id);
    let next = pruneSchedule({ ...kit, questions });
    // Generated / fallback deletions go on the dismissed list so regenerate
    // will not resurrect the same prompt (§6 / T19b).
    if (origin === "generated" || origin === "fallback" || origin == null) {
      const kitMeta = readKitMeta(next);
      const dismissed = Array.isArray(kitMeta.dismissed)
        ? [...kitMeta.dismissed]
        : [];
      const norm = normalisePrompt(q.prompt);
      if (!dismissed.map(normalisePrompt).includes(norm)) {
        dismissed.push(norm);
      }
      next = withKitMeta(next, { ...kitMeta, dismissed });
    }
    return next;
  }

  const exists = kit.flashcards.some((f) => f.id === op.id);
  if (!exists) {
    throw new ApplyOpsError("NOT_FOUND", `Flashcard ${op.id} not found.`);
  }
  return {
    ...kit,
    flashcards: kit.flashcards.filter((f) => f.id !== op.id),
  };
}

function applyReorder(kit: Kit, op: Extract<KitOp, { op: "reorder" }>): Kit {
  if (op.target === "questions") {
    const scoped = op.category
      ? kit.questions.filter((q) => q.category === op.category)
      : kit.questions;
    const scopedIds = new Set(scoped.map((q) => q.id));
    if (op.ids.length !== scoped.length || op.ids.some((id) => !scopedIds.has(id))) {
      throw new ApplyOpsError(
        "INVALID_OP",
        "reorder ids must be a permutation of the target question set.",
      );
    }
    const byId = new Map(kit.questions.map((q) => [q.id, q]));
    const reorderedScoped = op.ids.map((id) => byId.get(id)!);
    if (!op.category) {
      return { ...kit, questions: reorderedScoped };
    }
    // Rebuild: walk original list, swap in reordered category items in order.
    let i = 0;
    const questions = kit.questions.map((q) => {
      if (q.category !== op.category) return q;
      return reorderedScoped[i++]!;
    });
    return { ...kit, questions };
  }

  const ids = new Set(kit.flashcards.map((f) => f.id));
  if (op.ids.length !== kit.flashcards.length || op.ids.some((id) => !ids.has(id))) {
    throw new ApplyOpsError(
      "INVALID_OP",
      "reorder ids must be a permutation of flashcards.",
    );
  }
  const byId = new Map(kit.flashcards.map((f) => [f.id, f]));
  return { ...kit, flashcards: op.ids.map((id) => byId.get(id)!) };
}

function applyMove(kit: Kit, op: Extract<KitOp, { op: "move" }>): Kit {
  const idx = kit.questions.findIndex((q) => q.id === op.id);
  if (idx < 0) {
    throw new ApplyOpsError("NOT_FOUND", `Question ${op.id} not found.`);
  }
  const q = kit.questions[idx]!;
  if (q.category === op.category) return kit;
  const questions = [...kit.questions];
  questions[idx] = {
    ...q,
    category: op.category,
    meta: { ...asMeta(q.meta), updated_at: nowIso() },
  };
  return { ...kit, questions };
}

/**
 * Apply a batch of edit ops to an Appendix A kit document (pure).
 * Does not bump document `version` — caller persists that.
 */
export function applyKitOps(kit: Kit, ops: KitOp[]): Kit {
  let next = kit;
  for (const op of ops) {
    next = applyOne(next, op);
  }
  return next;
}
