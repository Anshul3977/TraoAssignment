import { Router } from "express";
import type { Kit } from "@prep/core";
import { sendError } from "../errors.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { findKitForUser } from "../kits/store.js";
import {
  hintStoriesForFlashcard,
  mapStoryBank,
  type StarStory,
} from "../lib/prepCore.js";
import { storiesFromDoc } from "../stories/store.js";
import {
  computeRequirementStats,
  orderNextSession,
} from "./leitner.js";
import { practiceReviewSchema, type PracticeReviewBody } from "./schema.js";
import {
  findPracticeState,
  practiceCardsToMap,
  recordReview,
  reviewedFlashcardIds,
} from "./store.js";

function kitIdParam(raw: string | string[] | undefined): string | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

function asKit(docKit: unknown): Kit {
  return docKit as Kit;
}

/**
 * Practice routes under `/kits/:id/practice/*` (T20).
 * Mount on the kits router (or compose via `createPracticeRouter`).
 */
export function createPracticeRouter(): Router {
  const router = Router({ mergeParams: true });

  router.post(
    "/review",
    requireAuth,
    validate("body", practiceReviewSchema),
    async (req, res) => {
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

      const body = req.body as PracticeReviewBody;
      const kit = asKit(doc.kit);
      const flashcard = kit.flashcards.find((f) => f.id === body.flashcardId);
      if (!flashcard) {
        sendError(res, 404, "NOT_FOUND", "Flashcard not found on this kit.");
        return;
      }

      const card = await recordReview(
        kitId,
        userId,
        body.flashcardId,
        body.confidence,
      );
      res.status(200).json({
        card,
        flashcard: {
          id: flashcard.id,
          front: flashcard.front,
          back: flashcard.back,
          requirement_ids: flashcard.requirement_ids,
        },
      });
    },
  );

  router.get("/next", requireAuth, async (req, res) => {
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

    const kit = asKit(doc.kit);
    const stories: StarStory[] = storiesFromDoc(doc);
    const storyMapping = mapStoryBank(
      stories,
      kit.role.requirements,
      kit.questions,
    );
    const byStory = new Map(stories.map((st) => [st.id, st]));
    const state = await findPracticeState(kitId, userId);
    const map = practiceCardsToMap(state);
    const orderedIds = orderNextSession(
      kit.flashcards.map((f) => f.id),
      map,
    );

    const byId = new Map(kit.flashcards.map((f) => [f.id, f]));
    const items = orderedIds.map((id) => {
      const f = byId.get(id)!;
      const s = map.get(id);
      const hints = hintStoriesForFlashcard(stories, storyMapping, f);
      return {
        flashcardId: id,
        front: f.front,
        back: f.back,
        requirement_ids: f.requirement_ids,
        box: s?.lastSeenAt != null ? s.box : null,
        lastConfidence: s?.lastConfidence ?? null,
        lastSeenAt: s?.lastSeenAt
          ? new Date(s.lastSeenAt).toISOString()
          : null,
        hintStories: hints
          .map((h) => {
            const story = byStory.get(h.storyId);
            if (!story) return null;
            return {
              id: story.id,
              title: story.title,
              situation: story.situation,
              task: story.task,
              action: story.action,
              result: story.result,
              score: h.score,
            };
          })
          .filter((x): x is NonNullable<typeof x> => x != null),
      };
    });

    res.status(200).json({ items });
  });

  router.get("/stats", requireAuth, async (req, res) => {
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

    const kit = asKit(doc.kit);
    const state = await findPracticeState(kitId, userId);
    const reviewed = reviewedFlashcardIds(state);
    const stats = computeRequirementStats(
      kit.role.requirements.map((r) => ({
        id: r.id,
        text: r.text,
        priority: r.priority,
      })),
      kit.flashcards.map((f) => ({
        id: f.id,
        requirement_ids: f.requirement_ids,
      })),
      reviewed,
    );

    res.status(200).json(stats);
  });

  return router;
}
