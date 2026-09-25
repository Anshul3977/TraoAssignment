import type { NextFunction, Request, Response } from "express";
import {
  SESSION_COOKIE,
  verifySessionToken,
} from "../auth/jwt.js";
import type { UserStore } from "../auth/store.js";
import { toPublicUser } from "../auth/store.js";
import { sendError } from "../errors.js";

/** Attach req.user when a valid session cookie is present; never rejects. */
export function attachSession(store: UserStore) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const raw = req.cookies?.[SESSION_COOKIE];
    if (typeof raw !== "string" || raw.length === 0) {
      next();
      return;
    }
    const verified = verifySessionToken(raw);
    if (!verified.ok) {
      req.sessionExpired = true;
      next();
      return;
    }
    const user = await store.findById(verified.payload.sub);
    if (!user) {
      req.sessionExpired = true;
      next();
      return;
    }
    req.user = toPublicUser(user);
    next();
  };
}

/**
 * Protect routes. Missing cookie → 401 UNAUTHENTICATED;
 * present but invalid/expired → 401 SESSION_EXPIRED.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.user) {
    next();
    return;
  }
  if (req.sessionExpired) {
    sendError(
      res,
      401,
      "SESSION_EXPIRED",
      "Session expired or invalid. Please sign in again.",
    );
    return;
  }
  sendError(res, 401, "UNAUTHENTICATED", "Authentication required.");
}
