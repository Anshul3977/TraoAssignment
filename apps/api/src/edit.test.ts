import type { Kit } from "@prep/core";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { createMongooseUserStore } from "./auth/mongooseStore.js";
import { connectMongo, disconnectMongo } from "./db/connect.js";
import { KitModel, UserModel } from "./models/index.js";
import type { Question, ResearchBundle } from "./lib/prepCore.js";

process.env.JWT_SECRET = "test-jwt-secret-t19b-do-not-use-elsewhere";
process.env.NODE_ENV = "test";

function sampleBundle(): ResearchBundle {
  return {
    homepage: {
      url: "https://example.com/",
      title: "Acme",
      description: "Widgets",
      text: "Acme builds widgets for teams.",
      links: [],
      kind: "other",
      score: 10,
    },
    aboutPages: [
      {
        url: "https://example.com/about",
        title: "About",
        description: "",
        text: "We value craft and mentoring.",
        links: [],
        kind: "about",
        score: 20,
      },
    ],
    hiringPages: [],
    otherPages: [],
    skipped: [],
    unreachable: false,
  };
}

function baseKit(): Kit {
  return {
    source: {
      company: "Acme",
      company_url: "https://example.com",
      role: "Senior Engineer",
      location: "Remote",
      jd_chars: 200,
      researched_at: "2026-09-25T00:00:00Z",
      pages_used: ["https://example.com"],
    },
    company_brief: {
      summary: "Acme builds widgets.",
      what_they_do: "Widget platform",
      sources: ["https://example.com"],
      meta: { edited: false },
    },
    role: {
      title: "Senior Engineer",
      seniority: "senior",
      responsibilities: ["Ship features"],
      requirements: [
        {
          id: "r1",
          text: "5+ years with React",
          kind: "technical",
          priority: "must",
        },
        {
          id: "r2",
          text: "Mentors juniors",
          kind: "behavioural",
          priority: "must",
        },
        {
          id: "r3",
          text: "GraphQL familiarity",
          kind: "technical",
          priority: "nice",
        },
      ],
    },
    questions: [
      {
        id: "q1",
        requirement_ids: ["r1"],
        category: "technical",
        prompt: "Explain React reconciliation.",
        answer_outline: "Virtual DOM…",
        difficulty: 2,
        meta: { origin: "generated", edited: false, pinned: false },
      },
      {
        id: "q2",
        requirement_ids: ["r3"],
        category: "technical",
        prompt: "When would you choose GraphQL?",
        answer_outline: "Overfetch…",
        difficulty: 1,
        meta: { origin: "generated", edited: false, pinned: false },
      },
      {
        id: "q3",
        requirement_ids: ["r2"],
        category: "behavioural",
        prompt: "Tell me about mentoring a junior.",
        answer_outline: "STAR…",
        difficulty: 2,
        meta: { origin: "generated", edited: false, pinned: false },
      },
    ],
    flashcards: [
      {
        id: "f1",
        front: "Reconciliation?",
        back: "Diffing trees",
        requirement_ids: ["r1"],
        meta: { origin: "generated", edited: false, pinned: false },
      },
    ],
    schedule: {
      days_available: 2,
      days: [
        { day: 1, focus: "React", question_ids: ["q1", "q2"], minutes: 40 },
        { day: 2, focus: "Behavioural", question_ids: ["q3"], minutes: 20 },
      ],
    },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
    meta: {
      next_ids: { question: 4, flashcard: 2 },
      dismissed: [],
    },
  };
}

describe("Edit + regenerate API (T19b)", () => {
  let mongo: MongoMemoryServer;
  let app: ReturnType<typeof createApp>["app"];
  let worker: ReturnType<typeof createApp>["worker"];

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
    ]);
    const store = createMongooseUserStore();
    ({ app, worker } = createApp({
      userStore: store,
      disableRateLimit: true,
      regenerateDeps: {
        buildBriefFn: async () => ({
          summary: "Regenerated brief about Acme widgets.",
          what_they_do: "Build widgets",
          sources: ["https://example.com/"],
          meta: { edited: false },
        }),
        generateCategoryFn: async (_kit, category) => {
          const q: Question = {
            id: "candidate-0",
            requirement_ids: category === "behavioural" ? ["r2"] : ["r1"],
            category,
            prompt: `Fresh ${category} question about the role`,
            answer_outline: "outline",
            difficulty: 2,
            meta: { origin: "generated", edited: false, pinned: false },
          };
          return [q];
        },
      },
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

  async function seedKit(
    userId: string,
    kit: Kit = baseKit(),
    extras: { researchBundle?: ResearchBundle; version?: number } = {},
  ) {
    return KitModel.create({
      userId,
      version: extras.version ?? 1,
      title: kit.role.title,
      input: {
        jd: "Need TypeScript and React",
        company_url: "https://example.com",
        days: 2,
      },
      kit,
      researchBundle: extras.researchBundle ?? sampleBundle(),
    });
  }

  it(
    "PATCH update preserves pin/edit meta and bumps version",
    async () => {
      const { agent, userId } = await register("alice@example.com");
      const doc = await seedKit(userId);

      const res = await agent.patch(`/kits/${String(doc._id)}`).send({
        baseVersion: 1,
        ops: [
          {
            op: "update",
            target: "question",
            id: "q1",
            set: { prompt: "Edited React prompt", pinned: true },
          },
        ],
      });
      expect(res.status).toBe(200);
      expect(res.body.kit.version).toBe(2);
      const q1 = res.body.kit.kit.questions.find((q: Question) => q.id === "q1");
      expect(q1.prompt).toBe("Edited React prompt");
      expect(q1.meta.edited).toBe(true);
      expect(q1.meta.pinned).toBe(true);
    },
    15_000,
  );

  it("409 VERSION_CONFLICT returns current kit when baseVersion mismatches", async () => {
    const { agent, userId } = await register("bob@example.com");
    const doc = await seedKit(userId, baseKit(), { version: 3 });

    const res = await agent.patch(`/kits/${String(doc._id)}`).send({
      baseVersion: 1,
      ops: [
        {
          op: "update",
          target: "brief",
          set: { summary: "Should not apply" },
        },
      ],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("VERSION_CONFLICT");
    expect(res.body.kit.version).toBe(3);
    expect(res.body.kit.kit.company_brief.summary).toBe("Acme builds widgets.");
  });

  it("delete generated question records normalised prompt in meta.dismissed", async () => {
    const { agent, userId } = await register("carol@example.com");
    const doc = await seedKit(userId);

    const res = await agent.patch(`/kits/${String(doc._id)}`).send({
      baseVersion: 1,
      ops: [{ op: "delete", target: "question", id: "q2" }],
    });
    expect(res.status).toBe(200);
    const dismissed = res.body.kit.kit.meta.dismissed as string[];
    expect(dismissed).toContain("when would you choose graphql?");
    expect(
      res.body.kit.kit.questions.some((q: Question) => q.id === "q2"),
    ).toBe(false);
  });

  it("regenerate questions keeps edited/pinned and does not resurrect dismissed", async () => {
    const { agent, userId } = await register("dave@example.com");
    const kit = baseKit();
    kit.questions = kit.questions.map((q) =>
      q.id === "q1"
        ? {
            ...q,
            prompt: "My pinned React question",
            meta: { origin: "generated", edited: true, pinned: true },
          }
        : q,
    );
    kit.meta = {
      ...(kit.meta as object),
      next_ids: { question: 10, flashcard: 2 },
      dismissed: ["fresh technical question about the role"],
    };
    const doc = await seedKit(userId, kit);

    const res = await agent
      .post(`/kits/${String(doc._id)}/regenerate`)
      .send({ section: "questions", category: "technical" });

    expect(res.status).toBe(200);
    expect(res.body.questionsChanged).toBe(true);
    const questions = res.body.kit.kit.questions as Question[];
    const tech = questions.filter((q) => q.category === "technical");
    expect(tech.some((q) => q.prompt === "My pinned React question")).toBe(
      true,
    );
    // Injected candidate prompt is dismissed → not resurrected
    expect(
      tech.some((q) =>
        q.prompt.toLowerCase().includes("fresh technical question"),
      ),
    ).toBe(false);
    // Behavioural untouched
    expect(questions.some((q) => q.id === "q3")).toBe(true);
  });

  it("regenerate brief skips when edited unless force", async () => {
    const { agent, userId } = await register("erin@example.com");
    const kit = baseKit();
    kit.company_brief = {
      ...kit.company_brief,
      summary: "User-written brief",
      meta: { edited: true },
    };
    const doc = await seedKit(userId, kit);

    const skipped = await agent
      .post(`/kits/${String(doc._id)}/regenerate`)
      .send({ section: "brief" });
    expect(skipped.status).toBe(200);
    expect(skipped.body.briefSkipped).toBe(true);
    expect(skipped.body.kit.kit.company_brief.summary).toBe(
      "User-written brief",
    );

    const forced = await agent
      .post(`/kits/${String(doc._id)}/regenerate`)
      .send({ section: "brief", force: true });
    expect(forced.status).toBe(200);
    expect(forced.body.briefSkipped).toBe(false);
    expect(forced.body.kit.kit.company_brief.summary).toContain("Regenerated");
  });

  it("regenerate schedule reallocates without clobbering questions", async () => {
    const { agent, userId } = await register("frank@example.com");
    const doc = await seedKit(userId);

    const res = await agent
      .post(`/kits/${String(doc._id)}/regenerate`)
      .send({ section: "schedule" });
    expect(res.status).toBe(200);
    expect(res.body.kit.kit.schedule.days_available).toBe(2);
    expect(res.body.kit.kit.schedule.days).toHaveLength(2);
    expect(res.body.kit.kit.questions).toHaveLength(3);
  });

  it("add + reorder + move ops work", async () => {
    const { agent, userId } = await register("gina@example.com");
    const doc = await seedKit(userId);

    const add = await agent.patch(`/kits/${String(doc._id)}`).send({
      baseVersion: 1,
      ops: [
        {
          op: "add",
          target: "question",
          value: {
            prompt: "My own question",
            answer_outline: "mine",
            category: "technical",
            difficulty: 2,
            requirement_ids: ["r1"],
          },
        },
      ],
    });
    expect(add.status).toBe(200);
    const added = add.body.kit.kit.questions.find(
      (q: Question) => q.prompt === "My own question",
    );
    expect(added.meta.origin).toBe("user");
    expect(added.id).toMatch(/^q\d+$/);

    const move = await agent.patch(`/kits/${String(doc._id)}`).send({
      baseVersion: 2,
      ops: [
        {
          op: "move",
          target: "question",
          id: added.id,
          category: "behavioural",
        },
        {
          op: "reorder",
          target: "questions",
          category: "behavioural",
          ids: [added.id, "q3"],
        },
      ],
    });
    expect(move.status).toBe(200);
    const behavioural = move.body.kit.kit.questions.filter(
      (q: Question) => q.category === "behavioural",
    );
    expect(behavioural.map((q: Question) => q.id)).toEqual([added.id, "q3"]);
  });
});
