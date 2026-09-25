import { Router } from "express";
import { sendError } from "../errors.js";
import { requireAuth } from "../middleware/auth.js";
import { retryFailedJob } from "./service.js";
import { findJobForUser, jobToPublic } from "./store.js";
import type { JobWorker } from "./worker.js";

export function createJobsRouter(worker: JobWorker): Router {
  const router = Router();

  router.get("/:id", requireAuth, async (req, res) => {
    const userId = req.user!.id;
    const rawId = req.params.id;
    const jobId = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!jobId) {
      sendError(res, 404, "NOT_FOUND", "Job not found.");
      return;
    }
    const doc = await findJobForUser(jobId, userId);
    if (!doc) {
      sendError(res, 404, "NOT_FOUND", "Job not found.");
      return;
    }
    res.status(200).json({ job: jobToPublic(doc) });
  });

  router.post("/:id/retry", requireAuth, async (req, res) => {
    const userId = req.user!.id;
    const rawId = req.params.id;
    const jobId = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!jobId) {
      sendError(res, 404, "NOT_FOUND", "Job not found.");
      return;
    }
    const doc = await findJobForUser(jobId, userId);
    if (!doc) {
      sendError(res, 404, "NOT_FOUND", "Job not found.");
      return;
    }
    if (doc.status !== "failed") {
      sendError(
        res,
        409,
        "NOT_RETRYABLE",
        `Only failed jobs can be retried (current status: ${doc.status}).`,
      );
      return;
    }
    const updated = await retryFailedJob(doc, worker);
    res.status(200).json({ job: jobToPublic(updated) });
  });

  return router;
}
