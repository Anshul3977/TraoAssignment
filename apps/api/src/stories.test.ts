import type { Kit } from "@prep/core";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { createMongooseUserStore } from "./auth/mongooseStore.js";
import { connectMongo, disconnectMongo } from "./db/connect.js";
import { KitModel, PracticeStateModel, UserModel } from "./models/index.js";

process.env.JWT_SECRET = "test-jwt-secret-t26-do-not-use-elsewhere";
process.env.NODE_ENV = "test";

function storyKit(): Kit {
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
          text: "mentoring juniors",
          kind: "behavioural",
          priority: "must",
        },
      ],
    },
    questions: [
      {
        id: "q1",
        requirement_ids: ["r2"],
        category: "behavioural",
        prompt: "Tell me about mentoring a junior",
        answer_outline: "STAR",
        difficulty: 2,
      },
    ],
    flashcards: [
      {
        id: "f1",
        front: "How do you mentor juniors?",
        back: "Pairing and checklists",
        requirement_ids: ["r2"],
        meta: { origin: "generated", edited: false, pinned: false },
      },
      {
        id: "f2",
        front: "React hooks?",
        back: "useState",
        requirement_ids: ["r1"],
        meta: { origin: "generated", edited: false, pinned: false },
      },
    ],
    schedule: {
      days_available: 1,
      days: [{ day: 1, focus: "Review", question_ids: ["q1"], minutes: 30 }],
    },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  };
}

const mentoringStory = {
  title: "Mentored a new hire",
  situation: "Our squad onboarded two junior engineers.",
  task: "I needed to mentor them without slipping delivery.",
  action: "Weekly pairing and a first-PR checklist.",
  result: "Both juniors shipped independently.",
};

describe("Story Bank API (T26)", () => {
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

  async function seedKit(userId: string) {
    return KitModel.create({
      userId,
      version: 1,
      title: "Engineer",
      input: {
        jd: "Need mentoring",
        company_url: "https://example.com",
        days: 5,
      },
      kit: storyKit(),
    });
  }

  it("GET empty bank flags mentoring juniors with no story", async () => {
    const { agent, userId } = await register("alice@example.com");
    const doc = await seedKit(userId);
    const res = await agent.get(`/kits/${String(doc._id)}/story-bank`);
    expect(res.status).toBe(200);
    expect(res.body.stories).toEqual([]);
    expect(res.body.mapping.uncovered).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requirementId: "r2",
          message: "You have no story for 'mentoring juniors'",
        }),
      ]),
    );
  });

  it("PUT assigns s1 and maps the mentoring requirement", async () => {
    const { agent, userId } = await register("bob@example.com");
    const doc = await seedKit(userId);
    const kitId = String(doc._id);

    const put = await agent
      .put(`/kits/${kitId}/story-bank`)
      .send({ stories: [mentoringStory] });
    expect(put.status).toBe(200);
    expect(put.body.stories[0].id).toBe("s1");
    const r2 = put.body.mapping.requirements.find(
      (r: { requirementId: string }) => r.requirementId === "r2",
    );
    expect(r2.candidates[0].storyId).toBe("s1");
    expect(put.body.mapping.uncovered).toEqual([]);

    const get = await agent.get(`/kits/${kitId}/story-bank`);
    expect(get.body.stories[0].title).toBe(mentoringStory.title);
  });

  it("practice /next includes the linked story as a hint", async () => {
    const { agent, userId } = await register("carol@example.com");
    const doc = await seedKit(userId);
    const kitId = String(doc._id);
    await agent.put(`/kits/${kitId}/story-bank`).send({ stories: [mentoringStory] });

    const next = await agent.get(`/kits/${kitId}/practice/next`);
    expect(next.status).toBe(200);
    const f1 = next.body.items.find(
      (i: { flashcardId: string }) => i.flashcardId === "f1",
    );
    expect(f1.hintStories[0].id).toBe("s1");
    expect(f1.hintStories[0].title).toBe(mentoringStory.title);
  });

  it("rejects 7 stories and foreign kits", async () => {
    const alice = await register("dave@example.com");
    const bob = await register("erin@example.com");
    const doc = await seedKit(alice.userId);
    const kitId = String(doc._id);

    const tooMany = await alice.agent.put(`/kits/${kitId}/story-bank`).send({
      stories: Array.from({ length: 7 }, () => mentoringStory),
    });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.code).toBe("VALIDATION_ERROR");

    const foreign = await bob.agent.get(`/kits/${kitId}/story-bank`);
    expect(foreign.status).toBe(404);
  });

  it("does not bump kit version on story save", async () => {
    const { agent, userId } = await register("frank@example.com");
    const doc = await seedKit(userId);
    await agent
      .put(`/kits/${String(doc._id)}/story-bank`)
      .send({ stories: [mentoringStory] });
    const again = await KitModel.findById(doc._id).exec();
    expect(again?.version).toBe(1);
  });
});
