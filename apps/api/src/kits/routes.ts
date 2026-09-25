import { Router } from "express";
import { sendError } from "../errors.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { createOrGetJob } from "../jobs/service.js";
import {
  kitBatchSchema,
  kitCreateSchema,
  type KitCreateBody,
} from "../jobs/schema.js";
import { jobToPublic } from "../jobs/store.js";
import type { JobWorker } from "../jobs/worker.js";
import { findKitForUser, kitToPublic } from "./store.js";

/**
 * Kit routes: create/batch (T18) + scoped read (T17b).
 * Register `/batch` before `/:id`.
 */
export function createKitsRouter(worker: JobWorker): Router {
  const router = Router();

  router.post(
    "/",
    requireAuth,
    validate("body", kitCreateSchema),
    async (req, res) => {
      const userId = req.user!.id;
      const body = req.body as KitCreateBody;
      const { job, created } = await createOrGetJob(userId, body, worker);
      res.status(created ? 201 : 200).json({ job: jobToPublic(job) });
    },
  );

  router.post(
    "/batch",
    requireAuth,
    validate("body", kitBatchSchema),
    async (req, res) => {
      const userId = req.user!.id;
      const items = req.body as KitCreateBody[];
      const jobs = [];
      for (const item of items) {
        const { job, created } = await createOrGetJob(userId, item, worker);
        jobs.push({ job: jobToPublic(job), created });
      }
      res.status(200).json({ jobs });
    },
  );

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
