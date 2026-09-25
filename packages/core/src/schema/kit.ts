import { z } from "zod";

/** Loose bag for optional per-item / kit extensions (origin, edited, pinned, …). */
export const ItemMetaSchema = z.record(z.string(), z.unknown()).optional();

export const RequirementKindSchema = z.enum([
  "technical",
  "behavioural",
  "domain",
]);
export const PrioritySchema = z.enum(["must", "nice"]);
export const QuestionCategorySchema = z.enum([
  "technical",
  "behavioural",
  "system-design",
  "company-fit",
]);
/** Appendix A: difficulty ∈ {1, 2, 3}. */
export const DifficultySchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

export const SourceSchema = z.object({
  company: z.string(),
  company_url: z.string(),
  role: z.string(),
  location: z.string(),
  jd_chars: z.number(),
  researched_at: z.string(),
  pages_used: z.array(z.string()),
});

export const CompanyBriefSchema = z.object({
  summary: z.string(),
  what_they_do: z.string(),
  sources: z.array(z.string()),
  meta: ItemMetaSchema,
});

export const RequirementSchema = z.object({
  id: z.string(),
  text: z.string(),
  kind: RequirementKindSchema,
  priority: PrioritySchema,
  meta: ItemMetaSchema,
});

export const RoleSchema = z.object({
  title: z.string(),
  seniority: z.string(),
  responsibilities: z.array(z.string()),
  requirements: z.array(RequirementSchema),
});

export const QuestionSchema = z.object({
  id: z.string(),
  requirement_ids: z.array(z.string()),
  category: QuestionCategorySchema,
  prompt: z.string(),
  answer_outline: z.string(),
  difficulty: DifficultySchema,
  meta: ItemMetaSchema,
});

export const FlashcardSchema = z.object({
  id: z.string(),
  front: z.string(),
  back: z.string(),
  requirement_ids: z.array(z.string()),
  meta: ItemMetaSchema,
});

export const ScheduleDaySchema = z.object({
  day: z.number().int(),
  focus: z.string(),
  question_ids: z.array(z.string()),
  /** Appendix A: integer minutes ≥ 0. */
  minutes: z.number().int().min(0),
});

export const ScheduleSchema = z.object({
  days_available: z.number().int(),
  days: z.array(ScheduleDaySchema),
});

export const CoverageSchema = z.object({
  uncovered_requirement_ids: z.array(z.string()),
  passes: z.number().int(),
});

/**
 * Appendix A kit shape with optional extensions only
 * (`research_log`, `notes`, per-item `meta`).
 */
export const KitSchema = z.object({
  source: SourceSchema,
  company_brief: CompanyBriefSchema,
  role: RoleSchema,
  questions: z.array(QuestionSchema),
  flashcards: z.array(FlashcardSchema),
  schedule: ScheduleSchema,
  coverage: CoverageSchema,
  research_log: z.record(z.string(), z.unknown()).optional(),
  notes: z.record(z.string(), z.unknown()).optional(),
  meta: ItemMetaSchema,
});

export type Kit = z.infer<typeof KitSchema>;
export type Requirement = z.infer<typeof RequirementSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type Flashcard = z.infer<typeof FlashcardSchema>;
export type ScheduleDay = z.infer<typeof ScheduleDaySchema>;
