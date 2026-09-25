import { Router } from "express";
import type { Kit } from "@prep/core";
import { sendError } from "../errors.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { findKitForUser } from "../kits/store.js";
import {
  assignStoryIds,
  mapStoryBank,
  type StarStory,
} from "../lib/prepCore.js";
import { storyBankPutSchema, type StoryBankPutBody } from "./schema.js";
import { saveStoryBank, storiesFromDoc } from "./store.js";

function kitIdParam(raw: string | string[] | undefined): string | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

function asKit(docKit: unknown): Kit {
  return docKit as Kit;
}

export function storyBankPayload(kit: Kit, stories: StarStory[]) {
  const mapping = mapStoryBank(
    stories,
    kit.role.requirements,
    kit.questions,
  );
  return { stories, mapping };
}

/**
 * Story Bank routes under `/kits/:id/story-bank` (T26).
 */
export function createStoryBankRouter(): Router {
  const router = Router({ mergeParams: true });

  router.get("/", requireAuth, async (req, res) => {
    const userId = req.user!.id;
    const kitId = kitIdParam(req.params.id);
    if (!kitId) {
      sendError(res, 404, "NOT_FOUND", "Kit not found.");
      return;
    }
    const doc = await findKitForUser(kitId, userId);
    if (!doc) {
      sendError(res, 404, "NOT_FOUND", "Kit not found.");
      return;
    }
    const stories = storiesFromDoc(doc);
    res.status(200).json(storyBankPayload(asKit(doc.kit), stories));
  });

  router.put(
    "/",
    requireAuth,
    validate("body", storyBankPutSchema),
    async (req, res) => {
      const userId = req.user!.id;
      const kitId = kitIdParam(req.params.id);
      if (!kitId) {
        sendError(res, 404, "NOT_FOUND", "Kit not found.");
        return;
      }
      const body = req.body as StoryBankPutBody;
      const stories = assignStoryIds(body.stories);
      const saved = await saveStoryBank(kitId, userId, stories);
      if (!saved) {
        sendError(res, 404, "NOT_FOUND", "Kit not found.");
        return;
      }
      res.status(200).json(storyBankPayload(asKit(saved.kit), stories));
    },
  );

  return router;
}
