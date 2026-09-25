import { z } from "zod";
import { MAX_STORIES } from "../lib/prepCore.js";

const storyDraftSchema = z.object({
  title: z.string().trim().min(1).max(120),
  situation: z.string().trim().min(1).max(2000),
  task: z.string().trim().min(1).max(2000),
  action: z.string().trim().min(1).max(4000),
  result: z.string().trim().min(1).max(2000),
});

/** PUT /kits/:id/story-bank — 0–6 STAR stories; ids assigned in code. */
export const storyBankPutSchema = z.object({
  stories: z.array(storyDraftSchema).max(MAX_STORIES),
});

export type StoryBankPutBody = z.infer<typeof storyBankPutSchema>;
