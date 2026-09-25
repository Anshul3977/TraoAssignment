import { Router } from "express";
import { validateKit, type Kit } from "@prep/core";
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
import { ApplyOpsError, applyKitOps } from "./applyOps.js";
import {
  kitPatchSchema,
  regenerateSchema,
  type KitPatchBody,
  type RegenerateBody,
} from "./opsSchema.js";
import {
  RegenerateError,
  regenerateKitSection,
  type RegenerateDeps,
  type StoredResearchBundle,
} from "./regenerate.js";
import {
  findKitForUser,
  kitToPublic,
  saveKitIfVersion,
} from "./store.js";

function kitIdParam(raw: string | string[] | undefined): string | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

function asKit(docKit: unknown): Kit {
  return docKit as Kit;
}

function asBundle(raw: unknown): StoredResearchBundle | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as StoredResearchBundle;
}

/**
 * Kit routes: create/batch (T18), scoped read (T17b), PATCH ops + regenerate (T19b).
 * Register `/batch` before `/:id`.
 */
export function createKitsRouter(
  worker: JobWorker,
  regenerateDeps: RegenerateDeps = {},
): Router {
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
    res.status(200).json({ kit: kitToPublic(doc) });
  });

  router.patch(
    "/:id",
    requireAuth,
    validate("body", kitPatchSchema),
    async (req, res) => {
      const userId = req.user!.id;
      const kitId = kitIdParam(req.params.id);
      if (!kitId) {
        sendError(res, 404, "NOT_FOUND", "Kit not found.");
        return;
      }
      const body = req.body as KitPatchBody;
      const doc = await findKitForUser(kitId, userId);
      if (!doc) {
        sendError(res, 404, "NOT_FOUND", "Kit not found.");
        return;
      }

      if (doc.version !== body.baseVersion) {
        res.status(409).json({
          error: {
            code: "VERSION_CONFLICT",
            message: "Kit was modified; reload and retry.",
          },
          kit: kitToPublic(doc),
        });
        return;
      }

      let nextKit: Kit;
      try {
        nextKit = applyKitOps(asKit(doc.kit), body.ops);
      } catch (err) {
        if (err instanceof ApplyOpsError) {
          const status = err.code === "NOT_FOUND" ? 404 : 400;
          sendError(res, status, err.code, err.message);
          return;
        }
        throw err;
      }

      const validated = validateKit(nextKit);
      if (!validated.ok) {
        sendError(res, 400, "INVALID_KIT", "Patched kit failed validation", {
          issues: validated.issues,
        });
        return;
      }

      const saved = await saveKitIfVersion(
        kitId,
        userId,
        body.baseVersion,
        validated.kit,
      );
      if (!saved.ok) {
        if (saved.reason === "not_found") {
          sendError(res, 404, "NOT_FOUND", "Kit not found.");
          return;
        }
        res.status(409).json({
          error: {
            code: "VERSION_CONFLICT",
            message: "Kit was modified; reload and retry.",
          },
          kit: kitToPublic(saved.doc),
        });
        return;
      }

      res.status(200).json({ kit: kitToPublic(saved.doc) });
    },
  );

  router.post(
    "/:id/regenerate",
    requireAuth,
    validate("body", regenerateSchema),
    async (req, res) => {
      const userId = req.user!.id;
      const kitId = kitIdParam(req.params.id);
      if (!kitId) {
        sendError(res, 404, "NOT_FOUND", "Kit not found.");
        return;
      }
      const body = req.body as RegenerateBody;
      const doc = await findKitForUser(kitId, userId);
      if (!doc) {
        sendError(res, 404, "NOT_FOUND", "Kit not found.");
        return;
      }

      let result;
      try {
        result = await regenerateKitSection(
          asKit(doc.kit),
          body,
          asBundle(doc.researchBundle),
          regenerateDeps,
        );
      } catch (err) {
        if (err instanceof RegenerateError) {
          const status =
            err.code === "MISSING_RESEARCH"
              ? 409
              : err.code === "VALIDATION_ERROR"
                ? 400
                : 400;
          sendError(res, status, err.code, err.message);
          return;
        }
        throw err;
      }

      if (result.briefSkipped) {
        res.status(200).json({
          kit: kitToPublic(doc),
          briefSkipped: true,
          questionsChanged: false,
        });
        return;
      }

      const validated = validateKit(result.kit);
      if (!validated.ok) {
        sendError(
          res,
          400,
          "INVALID_KIT",
          "Regenerated kit failed validation",
          { issues: validated.issues },
        );
        return;
      }

      const baseVersion = doc.version;
      const saved = await saveKitIfVersion(
        kitId,
        userId,
        baseVersion,
        validated.kit,
      );
      if (!saved.ok) {
        if (saved.reason === "not_found") {
          sendError(res, 404, "NOT_FOUND", "Kit not found.");
          return;
        }
        res.status(409).json({
          error: {
            code: "VERSION_CONFLICT",
            message: "Kit was modified; reload and retry.",
          },
          kit: kitToPublic(saved.doc),
        });
        return;
      }

      res.status(200).json({
        kit: kitToPublic(saved.doc),
        briefSkipped: result.briefSkipped,
        questionsChanged: result.questionsChanged,
      });
    },
  );

  return router;
}
