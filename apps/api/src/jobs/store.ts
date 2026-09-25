import mongoose from "mongoose";
import { JobModel, type JobDocument } from "../models/Job.js";

export type PublicJob = {
  id: string;
  userId: string;
  kitId: string | null;
  status: "queued" | "running" | "done" | "failed";
  steps: Array<{
    step: string;
    status: "running" | "done" | "skipped" | "failed";
    detail?: string;
  }>;
  error: { code: string; message: string } | null;
  input: { jd: string; company_url: string; days: number };
  createdAt: string;
  updatedAt: string;
};

export function jobToPublic(doc: JobDocument): PublicJob {
  const err = doc.error;
  const hasError =
    err &&
    typeof err.code === "string" &&
    err.code.length > 0 &&
    typeof err.message === "string";
  const input = doc.input;
  if (!input) {
    throw new Error(`Job ${String(doc._id)} is missing input`);
  }
  return {
    id: String(doc._id),
    userId: String(doc.userId),
    kitId: doc.kitId ? String(doc.kitId) : null,
    status: doc.status,
    steps: (doc.steps ?? []).map((s) => ({
      step: s.step,
      status: s.status,
      ...(s.detail !== undefined && s.detail !== null
        ? { detail: s.detail }
        : {}),
    })),
    error: hasError
      ? { code: err!.code as string, message: err!.message as string }
      : null,
    input: {
      jd: input.jd,
      company_url: input.company_url,
      days: input.days,
    },
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/**
 * Load a job only when it belongs to `userId`. Bad ids / foreign jobs → null
 * (callers treat as 404).
 */
export async function findJobForUser(
  jobId: string,
  userId: string,
): Promise<JobDocument | null> {
  if (
    !mongoose.Types.ObjectId.isValid(jobId) ||
    !mongoose.Types.ObjectId.isValid(userId)
  ) {
    return null;
  }
  return JobModel.findOne({ _id: jobId, userId }).exec();
}

/**
 * After a process restart, in-flight work cannot continue. Mark `running` jobs
 * failed with INTERRUPTED so the client can retry (§13).
 */
export async function markInterruptedRunningJobs(): Promise<number> {
  const result = await JobModel.updateMany(
    { status: "running" },
    {
      $set: {
        status: "failed",
        error: {
          code: "INTERRUPTED",
          message:
            "Server restarted while this job was running. Use retry to run it again.",
        },
      },
    },
  ).exec();
  return result.modifiedCount;
}

/** Re-enqueue jobs left in `queued` after a crash (not yet claimed by a worker). */
export async function listQueuedJobIds(): Promise<string[]> {
  const rows = await JobModel.find({ status: "queued" })
    .select("_id")
    .lean()
    .exec();
  return rows.map((r) => String(r._id));
}

export function isMongoDuplicateKey(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === 11000
  );
}
