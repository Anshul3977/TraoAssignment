import { JobModel, type JobDocument } from "../models/Job.js";
import { computeIdempotencyKey } from "./idempotency.js";
import { isMongoDuplicateKey } from "./store.js";
import type { JobWorker } from "./worker.js";

export type KitCreateInput = {
  jd: string;
  company_url: string;
  days: number;
};

/**
 * Create a queued generation job, or return an existing one for the same
 * idempotency key (running / done / queued / failed — no second pipeline).
 */
export async function createOrGetJob(
  userId: string,
  input: KitCreateInput,
  worker: JobWorker,
): Promise<{ job: JobDocument; created: boolean }> {
  const idempotencyKey = computeIdempotencyKey(
    userId,
    input.jd,
    input.company_url,
    input.days,
  );

  const existing = await JobModel.findOne({ userId, idempotencyKey }).exec();
  if (existing) {
    // Re-enqueue if somehow still queued but not in the worker (e.g. after
    // reconnect). Running/done/failed are left alone — failed uses /retry.
    if (existing.status === "queued") {
      worker.enqueue(String(existing._id));
    }
    return { job: existing, created: false };
  }

  try {
    const job = await JobModel.create({
      userId,
      idempotencyKey,
      status: "queued",
      steps: [],
      input: {
        jd: input.jd,
        company_url: input.company_url,
        days: input.days,
      },
    });
    worker.enqueue(String(job._id));
    return { job, created: true };
  } catch (err) {
    if (isMongoDuplicateKey(err)) {
      const again = await JobModel.findOne({ userId, idempotencyKey }).exec();
      if (again) {
        if (again.status === "queued") {
          worker.enqueue(String(again._id));
        }
        return { job: again, created: false };
      }
    }
    throw err;
  }
}

/**
 * Re-queue a failed job (including INTERRUPTED). Clears steps/error and
 * enqueues the same document (idempotency key unchanged).
 */
export async function retryFailedJob(
  job: JobDocument,
  worker: JobWorker,
): Promise<JobDocument> {
  if (job.status !== "failed") {
    return job;
  }
  const updated = await JobModel.findOneAndUpdate(
    { _id: job._id, status: "failed" },
    {
      $set: { status: "queued", steps: [] },
      $unset: { error: 1, kitId: 1 },
    },
    { returnDocument: "after" },
  ).exec();
  const next = updated ?? job;
  worker.enqueue(String(next._id));
  return next;
}
