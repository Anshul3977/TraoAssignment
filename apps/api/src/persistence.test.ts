import jwt from "jsonwebtoken";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { SESSION_COOKIE } from "./auth/jwt.js";
import { createMongooseUserStore } from "./auth/mongooseStore.js";
import { connectMongo, disconnectMongo } from "./db/connect.js";
import { KitModel, UserModel } from "./models/index.js";

process.env.JWT_SECRET = "test-jwt-secret-t17b-do-not-use-elsewhere";
process.env.NODE_ENV = "test";

const minimalKit = {
  source: {
    company: "Acme",
    company_url: "https://example.com",
    role: "Engineer",
    location: "Remote",
    jd_chars: 10,
    researched_at: new Date().toISOString(),
    pages_used: [],
  },
  company_brief: {
    summary: "A company",
    what_they_do: "Things",
    sources: [],
  },
  role: {
    title: "Engineer",
    seniority: "mid",
    responsibilities: [],
    requirements: [],
  },
  questions: [],
  flashcards: [],
  schedule: { days_available: 1, days: [{ day: 1, focus: "Review", question_ids: [], minutes: 30 }] },
  coverage: { uncovered_requirement_ids: [], passes: 1 },
};

describe("Persistence + kit scoping (T17b)", () => {
  let mongo: MongoMemoryServer;
  let app: ReturnType<typeof createApp>["app"];

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await connectMongo(mongo.getUri());
    const store = createMongooseUserStore();
    ({ app } = createApp({ userStore: store, disableRateLimit: true }));
  }, 120_000);

  afterAll(async () => {
    await disconnectMongo();
    await mongo.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      UserModel.deleteMany({}),
      KitModel.deleteMany({}),
    ]);
  });

  async function register(email: string, password = "password123") {
    const agent = request.agent(app);
    const res = await agent
      .post("/auth/register")
      .send({ email, password });
    expect(res.status).toBe(201);
    return { agent, userId: res.body.user.id as string };
  }

  it("cannot read another user's kit (404 NOT_FOUND)", async () => {
    const alice = await register("alice@example.com");
    const bob = await register("bob@example.com");

    const kit = await KitModel.create({
      userId: alice.userId,
      version: 1,
      title: "Alice kit",
      input: {
        jd: "Need TypeScript",
        company_url: "https://example.com",
        days: 5,
      },
      kit: minimalKit,
    });

    const res = await bob.agent.get(`/kits/${String(kit._id)}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");

    const own = await alice.agent.get(`/kits/${String(kit._id)}`);
    expect(own.status).toBe(200);
    expect(own.body.kit.id).toBe(String(kit._id));
    expect(own.body.kit.title).toBe("Alice kit");
  });

  it("expired token → 401 SESSION_EXPIRED on kit route", async () => {
    const { userId } = await register("dave@example.com");
    const kit = await KitModel.create({
      userId,
      version: 1,
      title: "Dave kit",
      input: {
        jd: "Need React",
        company_url: "https://example.com",
        days: 3,
      },
      kit: minimalKit,
    });

    const expired = jwt.sign(
      { sub: userId, email: "dave@example.com" },
      process.env.JWT_SECRET!,
      { expiresIn: -10 },
    );

    const res = await request(app)
      .get(`/kits/${String(kit._id)}`)
      .set("Cookie", `${SESSION_COOKIE}=${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("SESSION_EXPIRED");
  });

  it("mongoose User persists across store lookups", async () => {
    const store = createMongooseUserStore();
    const created = await store.create("persist@example.com", "hash");
    const byEmail = await store.findByEmail("persist@example.com");
    const byId = await store.findById(created.id);
    expect(byEmail?.id).toBe(created.id);
    expect(byId?.email).toBe("persist@example.com");
    expect(mongoose.Types.ObjectId.isValid(created.id)).toBe(true);
  });
});
