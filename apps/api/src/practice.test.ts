import type { Kit } from "@prep/core";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { createMongooseUserStore } from "./auth/mongooseStore.js";
import { connectMongo, disconnectMongo } from "./db/connect.js";
import { KitModel, PracticeStateModel, UserModel } from "./models/index.js";
import {
  computeRequirementStats,
  nextLeitnerBox,
  orderNextSession,
  type PracticeCardState,
} from "./practice/leitner.js";

process.env.JWT_SECRET = "test-jwt-secret-t20-do-not-use-elsewhere";
process.env.NODE_ENV = "test";

function practiceKit(): Kit {
  return {
    source: {
      company: "Acme",
      company_url: "https://example.com",
      role: "Engineer",
      location: "Remote",
      jd_chars: 100,
      researched_at: "2026-09-25T00:00:00Z",
      pages_used: [],
    },
    company_brief: {
      summary: "Acme",
      what_they_do: "Widgets",
      sources: [],
    },
    role: {
      title: "Engineer",
      seniority: "mid",
      responsibilities: [],
      requirements: [
        {
          id: "r1",
          text: "React",
          kind: "technical",
          priority: "must",
        },
        {
          id: "r2",
          text: "Mentoring",
          kind: "behavioural",
          priority: "must",
        },
        {
          id: "r3",
          text: "GraphQL",
          kind: "technical",
          priority: "nice",
        },
      ],
    },
    questions: [],
    flashcards: [
      {
        id: "f1",
        front: "React?",
        back: "UI lib",
        requirement_ids: ["r1"],
        meta: { origin: "generated", edited: false, pinned: false },
      },
      {
        id: "f2",
        front: "Mentor?",
        back: "Guide juniors",
        requirement_ids: ["r2"],
        meta: { origin: "generated", edited: false, pinned: false },
      },
      {
        id: "f3",
        front: "GraphQL?",
        back: "Query lang",
        requirement_ids: ["r3"],
        meta: { origin: "generated", edited: false, pinned: false },
      },
      {
        id: "f4",
        front: "Hooks?",
        back: "useState",
        requirement_ids: ["r1"],
        meta: { origin: "generated", edited: false, pinned: false },
      },
    ],
    schedule: {
      days_available: 1,
      days: [{ day: 1, focus: "Review", question_ids: [], minutes: 30 }],
    },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  };
}

describe("Leitner scheduling (T20 pure)", () => {
  it("maps confidence to boxes per T20 rules", () => {
    expect(nextLeitnerBox(3, 1)).toBe(1);
    expect(nextLeitnerBox(3, 2)).toBe(1);
    expect(nextLeitnerBox(5, 3)).toBe(2);
    expect(nextLeitnerBox(1, 4)).toBe(2);
    expect(nextLeitnerBox(2, 5)).toBe(3);
    expect(nextLeitnerBox(5, 5)).toBe(5);
    expect(nextLeitnerBox(undefined, 5)).toBe(2);
  });

  it("orders seen cards by box, then lastConfidence, then least-recently-seen", () => {
    const t1 = new Date("2026-09-20T00:00:00Z");
    const t2 = new Date("2026-09-21T00:00:00Z");
    const t3 = new Date("2026-09-22T00:00:00Z");
    const states = new Map<string, PracticeCardState>([
      [
        "a",
        {
          flashcardId: "a",
          box: 2,
          lastConfidence: 4,
          lastSeenAt: t2,
        },
      ],
      [
        "b",
        {
          flashcardId: "b",
          box: 1,
          lastConfidence: 2,
          lastSeenAt: t3,
        },
      ],
      [
        "c",
        {
          flashcardId: "c",
          box: 1,
          lastConfidence: 1,
          lastSeenAt: t1,
        },
      ],
      [
        "d",
        {
          flashcardId: "d",
          box: 1,
          lastConfidence: 1,
          lastSeenAt: t2,
        },
      ],
    ]);
    // All seen: box1 (c then d by time, then b by confidence) then box2 (a)
    expect(orderNextSession(["a", "b", "c", "d"], states)).toEqual([
      "c",
      "d",
      "b",
      "a",
    ]);
  });

  it("interleaves never-seen cards early with sorted seen cards", () => {
    const states = new Map<string, PracticeCardState>([
      [
        "s1",
        {
          flashcardId: "s1",
          box: 1,
          lastConfidence: 2,
          lastSeenAt: new Date("2026-09-20T00:00:00Z"),
        },
      ],
      [
        "s2",
        {
          flashcardId: "s2",
          box: 3,
          lastConfidence: 4,
          lastSeenAt: new Date("2026-09-21T00:00:00Z"),
        },
      ],
    ]);
    // never = n1,n2,n3; seen sorted = s1,s2
    // → n1,s1,n2,s2,n3
    expect(
      orderNextSession(["n1", "s1", "n2", "s2", "n3"], states),
    ).toEqual(["n1", "s1", "n2", "s2", "n3"]);
  });

  it("marks a requirement covered when any linked flashcard was reviewed", () => {
    const stats = computeRequirementStats(
      [
        { id: "r1", text: "React", priority: "must" },
        { id: "r2", text: "Mentor", priority: "must" },
        { id: "r3", text: "GraphQL", priority: "nice" },
      ],
      [
        { id: "f1", requirement_ids: ["r1"] },
        { id: "f2", requirement_ids: ["r2"] },
        { id: "f3", requirement_ids: ["r3"] },
      ],
      new Set(["f1"]),
    );
    expect(stats.requirements.map((r) => [r.id, r.covered])).toEqual([
      ["r1", true],
      ["r2", false],
      ["r3", false],
    ]);
    expect(stats.totals).toEqual({
      covered: 1,
      notCovered: 2,
      cards: 3,
      reviewed: 1,
    });
  });
});

describe("Practice API (T20)", () => {
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
      PracticeStateModel.deleteMany({}),
    ]);
    const store = createMongooseUserStore();
    ({ app, worker } = createApp({
      userStore: store,
      disableRateLimit: true,
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

  async function seedKit(userId: string, kit: Kit = practiceKit()) {
    return KitModel.create({
      userId,
      version: 1,
      title: kit.role.title,
      input: {
        jd: "Need React",
        company_url: "https://example.com",
        days: 5,
      },
      kit,
    });
  }

  it("GET /next returns kit flashcard order when nothing reviewed", async () => {
    const { agent, userId } = await register("alice@example.com");
    const doc = await seedKit(userId);

    const res = await agent.get(`/kits/${String(doc._id)}/practice/next`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { flashcardId: string }) => i.flashcardId)).toEqual([
      "f1",
      "f2",
      "f3",
      "f4",
    ]);
    expect(res.body.items[0].box).toBeNull();
  });

  it("POST /review updates Leitner box and reshapes /next order", async () => {
    const { agent, userId } = await register("bob@example.com");
    const doc = await seedKit(userId);
    const kitId = String(doc._id);

    const weak = await agent
      .post(`/kits/${kitId}/practice/review`)
      .send({ flashcardId: "f1", confidence: 1 });
    expect(weak.status).toBe(200);
    expect(weak.body.card.box).toBe(1);
    expect(weak.body.card.lastConfidence).toBe(1);

    const strong = await agent
      .post(`/kits/${kitId}/practice/review`)
      .send({ flashcardId: "f2", confidence: 5 });
    expect(strong.status).toBe(200);
    expect(strong.body.card.box).toBe(2);

    // Promote f2 again
    const promote = await agent
      .post(`/kits/${kitId}/practice/review`)
      .send({ flashcardId: "f2", confidence: 4 });
    expect(promote.status).toBe(200);
    expect(promote.body.card.box).toBe(3);

    const next = await agent.get(`/kits/${kitId}/practice/next`);
    expect(next.status).toBe(200);
    // never-seen f3,f4 interleaved early with seen sorted f1 (box1) then f2 (box3)
    // → f3, f1, f4, f2
    expect(next.body.items.map((i: { flashcardId: string }) => i.flashcardId)).toEqual([
      "f3",
      "f1",
      "f4",
      "f2",
    ]);
  });

  it("GET /stats reports covered/not-covered per requirement", async () => {
    const { agent, userId } = await register("carol@example.com");
    const doc = await seedKit(userId);
    const kitId = String(doc._id);

    await agent
      .post(`/kits/${kitId}/practice/review`)
      .send({ flashcardId: "f1", confidence: 3 });

    const stats = await agent.get(`/kits/${kitId}/practice/stats`);
    expect(stats.status).toBe(200);
    expect(stats.body.requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "r1", covered: true }),
        expect.objectContaining({ id: "r2", covered: false }),
        expect.objectContaining({ id: "r3", covered: false }),
      ]),
    );
    expect(stats.body.totals.covered).toBe(1);
    expect(stats.body.totals.notCovered).toBe(2);
    expect(stats.body.totals.reviewed).toBe(1);
  });

  it("rejects unknown flashcard and foreign kit", async () => {
    const alice = await register("dave@example.com");
    const bob = await register("erin@example.com");
    const doc = await seedKit(alice.userId);
    const kitId = String(doc._id);

    const missing = await alice.agent
      .post(`/kits/${kitId}/practice/review`)
      .send({ flashcardId: "f999", confidence: 3 });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("NOT_FOUND");

    const foreign = await bob.agent.get(`/kits/${kitId}/practice/next`);
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe("NOT_FOUND");
  });

  it("validates review body", async () => {
    const { agent, userId } = await register("frank@example.com");
    const doc = await seedKit(userId);
    const res = await agent
      .post(`/kits/${String(doc._id)}/practice/review`)
      .send({ flashcardId: "f1", confidence: 9 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});
