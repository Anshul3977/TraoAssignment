import { Router } from "express";
import { sendError } from "../errors.js";
import { requireAuth } from "../middleware/auth.js";
import { findKitForUser, kitToPublic } from "./store.js";

/**
 * Minimal kit read surface for T17b (scoping + reopen). Create/list/jobs
 * arrive in T18+.
 */
export function createKitsRouter(): Router {
  const router = Router();

  router.get("/:id", requireAuth, async (req, res) => {
    const userId = req.user!.id;
    const rawId = req.params.id;
    const kitId = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!kitId) {
      sendError(res, 404, "NOT_FOUND", "Kit not found.");
      return;
    }
    const doc = await findKitForUser(kitId, userId);
    if (!doc) {
      sendError(res, 404, "NOT_FOUND", "Kit not found.");
      return;
    }
    res.status(200).json({ kit: kitToPublic(doc) });
  });

  return router;
}
