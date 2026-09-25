import { z } from "zod";

const httpUrl = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine(
    (v) => {
      try {
        const u = new URL(v);
        return u.protocol === "http:" || u.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "company_url must be a valid http(s) URL" },
  );

export const kitCreateSchema = z.object({
  jd: z.string().trim().min(1, "jd is required").max(100_000),
  company_url: httpUrl,
  days: z.number().int().min(1).max(60),
});

export const kitBatchSchema = z.array(kitCreateSchema).min(1).max(50);

export type KitCreateBody = z.infer<typeof kitCreateSchema>;
