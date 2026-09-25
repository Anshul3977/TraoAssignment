import {
  isPipelineError,
  runPipeline,
  validateKit,
  type PipelineInput,
  type PipelineOptions,
  type PipelineResult,
  type ProgressEvent,
} from "@prep/core";
import { KitModel } from "../models/Kit.js";
import { JobModel } from "../models/Job.js";

export type PipelineRunner = (
  input: PipelineInput,
  opts: PipelineOptions,
) => Promise<PipelineResult>;

export type JobWorkerOptions = {
  runPipeline?: PipelineRunner;
  allowPrivateHosts?: boolean;
  /** Max jobs processed concurrently (in-process). Default 1. */
  concurrency?: number;
};

type StepEntry = {
  step: string;
  status: "running" | "done" | "skipped" | "failed";
  detail?: string;
};

/**
 * In-process generation worker. Persists pipeline progress onto the Job
 * document so clients can poll `GET /jobs/:id` during long runs (~90 s).
 */
export class JobWorker {
  private readonly queue: string[] = [];
  private readonly inFlight = new Set<string>();
  private readonly progressChains = new Map<string, Promise<void>>();
  private active = 0;
  private stopped = false;
  private readonly runner: PipelineRunner;
  private readonly allowPrivateHosts: boolean;
  private readonly concurrency: number;

  constructor(options: JobWorkerOptions = {}) {
    this.runner = options.runPipeline ?? runPipeline;
    this.allowPrivateHosts =
      options.allowPrivateHosts ?? process.env.ALLOW_PRIVATE_HOSTS === "true";
    this.concurrency = Math.max(1, options.concurrency ?? 1);
  }

  enqueue(jobId: string): void {
    if (this.stopped) return;
    if (this.inFlight.has(jobId) || this.queue.includes(jobId)) return;
    this.queue.push(jobId);
    this.pump();
  }

  stop(): void {
    this.stopped = true;
    this.queue.length = 0;
  }

  /** Wait until in-flight work drains (tests / graceful shutdown). */
  async idle(timeoutMs = 10_000): Promise<void> {
    const start = Date.now();
    while (this.active > 0) {
      if (Date.now() - start > timeoutMs) {
        throw new Error("JobWorker.idle timed out");
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    await Promise.all([...this.progressChains.values()]);
  }

  private pump(): void {
    while (
      !this.stopped &&
      this.active < this.concurrency &&
      this.queue.length > 0
    ) {
      const jobId = this.queue.shift()!;
      this.inFlight.add(jobId);
      this.active += 1;
      void this.runOne(jobId).finally(() => {
        this.inFlight.delete(jobId);
        this.active -= 1;
        this.pump();
      });
    }
  }

  private async runOne(jobId: string): Promise<void> {
    const claimed = await JobModel.findOneAndUpdate(
      { _id: jobId, status: "queued" },
      { $set: { status: "running" }, $unset: { error: 1 } },
      { returnDocument: "after" },
    ).exec();

    if (!claimed?.input) {
      return;
    }

    const input: PipelineInput = {
      jd: claimed.input.jd,
      company_url: claimed.input.company_url,
      days: claimed.input.days,
    };

    try {
      const result = await this.runner(input, {
        allowPrivateHosts: this.allowPrivateHosts,
        onProgress: (event) => {
          this.queueProgress(jobId, event);
        },
      });

      await this.flushProgress(jobId);

      const validated = validateKit(result.kit);
      if (!validated.ok) {
        const detail = validated.issues
          .map((i) => `${i.path}: ${i.message}`)
          .join("; ");
        await this.failJob(jobId, "INVALID_KIT", `Kit failed validation: ${detail}`);
        return;
      }

      const title =
        validated.kit.role?.title?.trim() ||
        validated.kit.source?.role?.trim() ||
        "Untitled kit";

      const kitDoc = await KitModel.create({
        userId: claimed.userId,
        version: 1,
        title,
        input: {
          jd: input.jd,
          company_url: input.company_url,
          days: input.days,
        },
        kit: validated.kit,
      });

      await JobModel.updateOne(
        { _id: jobId },
        {
          $set: {
            status: "done",
            kitId: kitDoc._id,
          },
          $unset: { error: 1 },
        },
      ).exec();
    } catch (err) {
      await this.flushProgress(jobId);
      const { code, message } = toJobError(err);
      await this.failJob(jobId, code, message);
    } finally {
      this.progressChains.delete(jobId);
    }
  }

  private queueProgress(jobId: string, event: ProgressEvent): void {
    const prev = this.progressChains.get(jobId) ?? Promise.resolve();
    const next = prev
      .then(() => this.persistProgress(jobId, event))
      .catch(() => {
        /* swallow — final job status still written */
      });
    this.progressChains.set(jobId, next);
  }

  private async flushProgress(jobId: string): Promise<void> {
    await (this.progressChains.get(jobId) ?? Promise.resolve());
  }

  private async persistProgress(
    jobId: string,
    event: ProgressEvent,
  ): Promise<void> {
    const job = await JobModel.findById(jobId).lean().exec();
    if (!job || job.status !== "running") return;

    const steps: StepEntry[] = (job.steps ?? []).map((s) => ({
      step: s.step,
      status: s.status,
      ...(s.detail != null && s.detail !== "" ? { detail: s.detail } : {}),
    }));
    const idx = steps.findIndex((s) => s.step === event.step);
    const entry: StepEntry = {
      step: event.step,
      status: event.status,
      ...(event.detail !== undefined ? { detail: event.detail } : {}),
    };
    if (idx >= 0) {
      steps[idx] = entry;
    } else {
      steps.push(entry);
    }

    await JobModel.updateOne(
      { _id: jobId, status: "running" },
      { $set: { steps } },
    ).exec();
  }

  private async failJob(
    jobId: string,
    code: string,
    message: string,
  ): Promise<void> {
    await JobModel.updateOne(
      { _id: jobId, status: { $in: ["queued", "running"] } },
      {
        $set: {
          status: "failed",
          error: { code, message },
        },
      },
    ).exec();
  }
}

function toJobError(err: unknown): { code: string; message: string } {
  if (isPipelineError(err)) {
    return { code: err.code, message: err.message };
  }
  if (err instanceof Error) {
    return { code: "INTERNAL_ERROR", message: err.message };
  }
  return { code: "INTERNAL_ERROR", message: String(err) };
}
