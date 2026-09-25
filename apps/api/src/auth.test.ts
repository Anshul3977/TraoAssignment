import jwt from "jsonwebtoken";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { SESSION_COOKIE } from "./auth/jwt.js";

process.env.JWT_SECRET = "test-jwt-secret-t17a-do-not-use-elsewhere";
process.env.NODE_ENV = "test";

describe("API auth + health (T17a)", () => {
  const { app, userStore } = createApp({ disableRateLimit: true });

  afterEach(() => {
    userStore.clear();
  });

  it("GET /health returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("register → sets session cookie → /auth/me returns user", async () => {
    const agent = request.agent(app);
    const reg = await agent
      .post("/auth/register")
      .send({ email: "alice@example.com", password: "password123" });
    expect(reg.status).toBe(201);
    expect(reg.body.user).toEqual({
      id: expect.any(String),
      email: "alice@example.com",
    });
    const setCookie = reg.headers["set-cookie"];
    const cookieHeader = Array.isArray(setCookie)
      ? setCookie.join(";")
      : typeof setCookie === "string"
        ? setCookie
        : "";
    expect(cookieHeader).toContain(`${SESSION_COOKIE}=`);

    const me = await agent.get("/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("alice@example.com");
  });

  it("duplicate register returns 409 EMAIL_TAKEN", async () => {
    await request(app)
      .post("/auth/register")
      .send({ email: "dup@example.com", password: "password123" });
    const res = await request(app)
      .post("/auth/register")
      .send({ email: "dup@example.com", password: "password123" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_TAKEN");
  });

  it("login with wrong password returns INVALID_CREDENTIALS", async () => {
    await request(app)
      .post("/auth/register")
      .send({ email: "bob@example.com", password: "password123" });
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "bob@example.com", password: "wrong-password" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("login then logout clears session; /me is UNAUTHENTICATED", async () => {
    const agent = request.agent(app);
    await agent
      .post("/auth/register")
      .send({ email: "carol@example.com", password: "password123" });
    const logout = await agent.post("/auth/logout");
    expect(logout.status).toBe(204);

    const me = await agent.get("/auth/me");
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("signed-out /auth/me returns 401 UNAUTHENTICATED", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({
      code: "UNAUTHENTICATED",
      message: expect.any(String),
    });
  });

  it("expired token returns 401 SESSION_EXPIRED", async () => {
    const reg = await request(app)
      .post("/auth/register")
      .send({ email: "dave@example.com", password: "password123" });
    const userId = reg.body.user.id as string;
    const expired = jwt.sign(
      { sub: userId, email: "dave@example.com" },
      process.env.JWT_SECRET!,
      { expiresIn: -10 },
    );
    const res = await request(app)
      .get("/auth/me")
      .set("Cookie", `${SESSION_COOKIE}=${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("SESSION_EXPIRED");
  });

  it("invalid token returns 401 SESSION_EXPIRED", async () => {
    const res = await request(app)
      .get("/auth/me")
      .set("Cookie", `${SESSION_COOKIE}=not.a.jwt`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("SESSION_EXPIRED");
  });

  it("validation failure returns 400 VALIDATION_ERROR", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ email: "not-an-email", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details).toBeDefined();
  });

  it("login succeeds and sets cookie", async () => {
    await request(app)
      .post("/auth/register")
      .send({ email: "erin@example.com", password: "password123" });
    const agent = request.agent(app);
    const login = await agent
      .post("/auth/login")
      .send({ email: "erin@example.com", password: "password123" });
    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe("erin@example.com");
    const me = await agent.get("/auth/me");
    expect(me.status).toBe(200);
  });
});
