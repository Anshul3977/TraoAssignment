import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { sendError } from "../errors.js";

type RequestPart = "body" | "query" | "params";

/** Zod-validate a request part; on failure respond 400 VALIDATION_ERROR. */
export function validate<T>(part: RequestPart, schema: ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req[part]);
    if (!parsed.success) {
      sendError(res, 400, "VALIDATION_ERROR", "Request validation failed", {
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
      return;
    }
    (req as Request & Record<RequestPart, T>)[part] = parsed.data;
    next();
  };
}
