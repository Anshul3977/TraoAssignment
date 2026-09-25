import { PipelineError, type Kit, type PipelineResult } from "@prep/core";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { createMongooseUserStore } from "./auth/mongooseStore.js";
import { connectMongo, disconnectMongo } from "./db/connect.js";
import { computeIdempotencyKey } from "./jobs/idempotency.js";
import {
  listQueuedJobIds,
  markInterruptedRunningJobs,
} from "./jobs/store.js";
import type { PipelineRunner } from "./jobs/worker.js";
import { JobModel, KitModel, UserModel } from "./models/index.js";

process.env.JWT_SECRET = "test-jwt-secret-t18-do-not-use-elsewhere";
process.env.NODE_ENV = "test";

function minimalKit(days: number): Kit {
  return {
    source: {
      company: "Acme",
      company_url: "https://example.com",
      role: "Engineer",
      location: "Remote",
      jd_chars: 40,
      researched_at: "2026-09-25T00:00:00Z",
      pages_used: ["https://example.com"],
    },
    company_brief: {
      summary: "Widgets",
      what_they_do: "Build widgets",
      sources: ["https://example.com"],
    },
    role: {
      title: "Engineer",
      seniority: "mid",
      responsibilities: ["Ship"],
      requirements: [
        {
          id: "r1",
          text: "TypeScript",
          kind: "technical",
          priority: "must",
        },
      ],
    },
    questions: [
      {
        id: "q1",
        requirement_ids: ["r1"],
        category: "technical",
        prompt: "Talk about TypeScript",
        answer_outline: "Types",
        difficulty: 1,
      },
    ],
    flashcards: [
      {
        id: "f1",
        front: "TS",
        back: "typed JS",
        requirement_ids: ["r1"],
      },
    ],
    schedule: {
      days_available: days,
      days: Array.from({ length: days }, (_, i) => ({
        day: i + 1,
        focus: "Prep",
        question_ids: ["q1"],
        minutes: 30,
      })),
    },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  };
}

async function waitForJob(
  agent: ReturnType<typeof request.agent>,
  jobId: string,
  pred: (job: { status: string; error?: { code: string } | null; kitId?: string | null }) => boolean,
  timeoutMs = 8_000,
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await agent.get(`/jobs/${jobId}`);
    expect(res.status).toBe(200);
    if (pred(res.body.job)) return res.body.job;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
}

describe("Generation jobs (T18)", () => {
  let mongo: MongoMemoryServer;
  let app: ReturnType<typeof createApp>["app"];
  let worker: ReturnType<typeof createApp>["worker"];
  let runCalls = 0;
  let failNext = false;

  const fakeRunner: PipelineRunner = async (input, opts) => {
    runCalls += 1;
    opts.onProgress?.({ step: "extract", status: "running" });
    opts.onProgress?.({ step: "extract", status: "done" });
    if (failNext) {
      failNext = false;
      opts.onProgress?.({
        step: "extract",
        status: "failed",
        detail: "boom",
      });
      throw new PipelineError("EMPTY_JD", "Job description is empty.");
    }
    await new Promise((r) => setTimeout(r, 30));
    opts.onProgress?.({ step: "validate", status: "done" });
    return { kit: minimalKit(input.days) } satisfies PipelineResult;
  };

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await connectMongo(mongo.getUri());
  }, 120_000);

  beforeEach(async () => {
    if (worker) {
      worker.stop();
      await worker.idle().catch(() => undefined);
    }
    await Promise.all([
      UserModel.deleteMany({}),
      KitModel.deleteMany({}),
      JobModel.deleteMany({}),
    ]);
    runCalls = 0;
    failNext = false;
    const store = createMongooseUserStore();
    ({ app, worker } = createApp({
      userStore: store,
      disableRateLimit: true,
      runPipeline: fakeRunner,
      allowPrivateHosts: true,
    }));
  });

  afterAll(async () => {
    if (worker) {
      worker.stop();
      await worker.idle().catch(() => undefined);
    }
    await disconnectMongo();
    await mongo.stop();
  });

  async function register(email: string) {
    const agent = request.agent(app);
    const res = await agent
      .post("/auth/register")
      .send({ email, password: "password123" });
    expect(res.status).toBe(201);
    return { agent, userId: res.body.user.id as string };
  }

  const sampleInput = {
    jd: "Need a TypeScript engineer with React experience.",
    company_url: "https://example.com/careers",
    days: 5,
  };

  it("double submit returns the same job (200) without a second pipeline", async () => {
    const { agent } = await register("alice@example.com");

    const first = await agent.post("/kits").send(sampleInput);
    expect(first.status).toBe(201);
    const jobId = first.body.job.id as string;
    expect(first.body.job.status).toMatch(/queued|running|done/);

    const second = await agent.post("/kits").send({
      ...sampleInput,
      jd: "  Need a TypeScript engineer with React experience.  ",
      company_url: "https://example.com/careers/",
    });
    expect(second.status).toBe(200);
    expect(second.body.job.id).toBe(jobId);

    const done = await waitForJob(agent, jobId, (j) => j.status === "done");
    expect(done.kitId).toBeTruthy();
    expect(runCalls).toBe(1);

    const kitRes = await agent.get(`/kits/${done.kitId}`);
    expect(kitRes.status).toBe(200);
    expect(kitRes.body.kit.title).toBe("Engineer");
  });

  it("records failure with a pipeline error code", async () => {
    failNext = true;
    const { agent } = await register("bob@example.com");

    const created = await agent.post("/kits").send({
      jd: "x",
      company_url: "https://example.com",
      days: 1,
    });
    expect(created.status).toBe(201);
    const jobId = created.body.job.id as string;

    const failed = await waitForJob(agent, jobId, (j) => j.status === "failed");
    expect(failed.error?.code).toBe("EMPTY_JD");
    expect(failed.kitId).toBeNull();
  });

  it("retry re-queues a failed job and can succeed", async () => {
    failNext = true;
    const { agent } = await register("carol@example.com");

    const created = await agent.post("/kits").send(sampleInput);
    const jobId = created.body.job.id as string;
    await waitForJob(agent, jobId, (j) => j.status === "failed");

    const retried = await agent.post(`/jobs/${jobId}/retry`);
    expect(retried.status).toBe(200);
    expect(retried.body.job.status).toBe("queued");

    const done = await waitForJob(agent, jobId, (j) => j.status === "done");
    expect(done.kitId).toBeTruthy();
    expect(runCalls).toBe(2);
  });

  it("POST /kits/batch creates one job per row (idempotent within the array)", async () => {
    const { agent } = await register("dave@example.com");
    const res = await agent.post("/kits/batch").send([
      sampleInput,
      { ...sampleInput, days: 3 },
      sampleInput,
    ]);
    expect(res.status).toBe(200);
    expect(res.body.jobs).toHaveLength(3);
    expect(res.body.jobs[0].created).toBe(true);
    expect(res.body.jobs[1].created).toBe(true);
    expect(res.body.jobs[2].created).toBe(false);
    expect(res.body.jobs[2].job.id).toBe(res.body.jobs[0].job.id);
  });

  it("boot helper marks running jobs INTERRUPTED", async () => {
    const { userId } = await register("eve@example.com");
    const key = computeIdempotencyKey(
      userId,
      sampleInput.jd,
      sampleInput.company_url,
      sampleInput.days,
    );
    await JobModel.create({
      userId,
      idempotencyKey: key,
      status: "running",
      steps: [{ step: "crawl", status: "running" }],
      input: sampleInput,
    });

    const n = await markInterruptedRunningJobs();
    expect(n).toBe(1);
    const job = await JobModel.findOne({ userId }).exec();
    expect(job?.status).toBe("failed");
    expect(job?.error?.code).toBe("INTERRUPTED");
    expect(await listQueuedJobIds()).toEqual([]);
  });

  it("GET /jobs/:id is scoped — foreign job → 404", async () => {
    const alice = await register("alice2@example.com");
    const bob = await register("bob2@example.com");
    const created = await alice.agent.post("/kits").send(sampleInput);
    const jobId = created.body.job.id as string;

    const res = await bob.agent.get(`/jobs/${jobId}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
