import { z } from "zod";
import { KitSchema } from "./kit.js";

export const BatchErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export const BatchKitEntrySchema = z.object({
  id: z.string(),
  status: z.enum(["ok", "failed"]),
  kit: KitSchema.nullable(),
  error: BatchErrorSchema.nullable(),
});

/** Appendix B batch output shape. */
export const BatchOutputSchema = z.object({
  version: z.string(),
  generated_at: z.string(),
  kits: z.array(BatchKitEntrySchema),
});

export type BatchError = z.infer<typeof BatchErrorSchema>;
export type BatchKitEntry = z.infer<typeof BatchKitEntrySchema>;
export type BatchOutput = z.infer<typeof BatchOutputSchema>;
