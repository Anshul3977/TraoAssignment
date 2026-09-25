import { z } from "zod";

export const practiceReviewSchema = z.object({
  flashcardId: z.string().trim().min(1).max(64),
  confidence: z.number().int().min(1).max(5),
});

export type PracticeReviewBody = z.infer<typeof practiceReviewSchema>;
