import { z } from "zod";

const questionCategory = z.enum([
  "technical",
  "behavioural",
  "system-design",
  "company-fit",
]);

const difficulty = z.union([z.literal(1), z.literal(2), z.literal(3)]);

const updateBriefOp = z.object({
  op: z.literal("update"),
  target: z.literal("brief"),
  set: z
    .object({
      summary: z.string().min(1).optional(),
      what_they_do: z.string().min(1).optional(),
    })
    .refine((s) => s.summary !== undefined || s.what_they_do !== undefined, {
      message: "set must include at least one brief field",
    }),
});

const updateQuestionOp = z.object({
  op: z.literal("update"),
  target: z.literal("question"),
  id: z.string().min(1),
  set: z
    .object({
      prompt: z.string().min(1).optional(),
      answer_outline: z.string().min(1).optional(),
      difficulty: difficulty.optional(),
      requirement_ids: z.array(z.string()).optional(),
      pinned: z.boolean().optional(),
    })
    .refine((s) => Object.keys(s).length > 0, {
      message: "set must include at least one field",
    }),
});

const updateFlashcardOp = z.object({
  op: z.literal("update"),
  target: z.literal("flashcard"),
  id: z.string().min(1),
  set: z
    .object({
      front: z.string().min(1).optional(),
      back: z.string().min(1).optional(),
      requirement_ids: z.array(z.string()).optional(),
      pinned: z.boolean().optional(),
    })
    .refine((s) => Object.keys(s).length > 0, {
      message: "set must include at least one field",
    }),
});

const updateRequirementOp = z.object({
  op: z.literal("update"),
  target: z.literal("requirement"),
  id: z.string().min(1),
  set: z
    .object({
      text: z.string().min(1).optional(),
      priority: z.enum(["must", "nice"]).optional(),
      kind: z.enum(["technical", "behavioural", "domain"]).optional(),
    })
    .refine((s) => Object.keys(s).length > 0, {
      message: "set must include at least one field",
    }),
});

const addQuestionOp = z.object({
  op: z.literal("add"),
  target: z.literal("question"),
  value: z.object({
    prompt: z.string().min(1),
    answer_outline: z.string().min(1),
    category: questionCategory,
    difficulty: difficulty.default(2),
    requirement_ids: z.array(z.string()).default([]),
  }),
});

const addFlashcardOp = z.object({
  op: z.literal("add"),
  target: z.literal("flashcard"),
  value: z.object({
    front: z.string().min(1),
    back: z.string().min(1),
    requirement_ids: z.array(z.string()).default([]),
  }),
});

const deleteOp = z.object({
  op: z.literal("delete"),
  target: z.enum(["question", "flashcard"]),
  id: z.string().min(1),
});

const reorderOp = z.object({
  op: z.literal("reorder"),
  target: z.enum(["questions", "flashcards"]),
  ids: z.array(z.string().min(1)).min(1),
  /** When set, only reorder items in this category (questions). */
  category: questionCategory.optional(),
});

const moveOp = z.object({
  op: z.literal("move"),
  target: z.literal("question"),
  id: z.string().min(1),
  category: questionCategory,
});

export const kitOpSchema = z.union([
  updateBriefOp,
  updateQuestionOp,
  updateFlashcardOp,
  updateRequirementOp,
  addQuestionOp,
  addFlashcardOp,
  deleteOp,
  reorderOp,
  moveOp,
]);

export const kitPatchSchema = z.object({
  baseVersion: z.number().int().min(1),
  ops: z.array(kitOpSchema).min(1).max(100),
});

export type KitOp = z.infer<typeof kitOpSchema>;
export type KitPatchBody = z.infer<typeof kitPatchSchema>;

export const regenerateSchema = z
  .object({
    section: z.enum(["brief", "schedule", "questions"]),
    category: questionCategory.optional(),
    force: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.section === "questions" && !v.category) {
      ctx.addIssue({
        code: "custom",
        message: "category is required when section is questions",
        path: ["category"],
      });
    }
  });

export type RegenerateBody = z.infer<typeof regenerateSchema>;
