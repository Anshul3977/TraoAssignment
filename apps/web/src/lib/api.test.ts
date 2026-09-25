import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiClientError,
  apiFetch,
  apiPath,
  createKit,
  createKitsBatch,
  getJob,
  getKit,
  kitFromConflictError,
  login,
  loginRedirectUrl,
  logout,
  patchKit,
  regenerateKitBrief,
  regenerateKitQuestions,
  regenerateKitSchedule,
  retryJob,
} from "./api";

describe("apiPath", () => {
  it("prefixes contract paths with /api for the Next rewrite", () => {
    expect(apiPath("/auth/login")).toBe("/api/auth/login");
    expect(apiPath("health")).toBe("/api/health");
  });
});

describe("loginRedirectUrl", () => {
  it("encodes next path", () => {
    expect(loginRedirectUrl("/kits/new")).toBe(
      "/login?next=%2Fkits%2Fnew",
    );
  });
});

describe("apiFetch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends credentials: include", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await apiFetch("/health", {}, { fetch: fetchMock });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("on 401 redirects to /login?next= and throws", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "UNAUTHENTICATED", message: "Not signed in" },
        }),
        { status: 401 },
      ),
    );
    const redirectTo = vi.fn();
    await expect(
      apiFetch(
        "/auth/me",
        {},
        {
          fetch: fetchMock,
          redirectTo,
          currentPath: () => "/dashboard",
        },
      ),
    ).rejects.toBeInstanceOf(ApiClientError);
    expect(redirectTo).toHaveBeenCalledWith("/login?next=%2Fdashboard");
  });

  it("skips redirect when skipAuthRedirect is set", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "UNAUTHENTICATED", message: "Not signed in" },
        }),
        { status: 401 },
      ),
    );
    const redirectTo = vi.fn();
    await expect(
      apiFetch(
        "/auth/me",
        { skipAuthRedirect: true },
        { fetch: fetchMock, redirectTo },
      ),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    expect(redirectTo).not.toHaveBeenCalled();
  });

  it("treats 204 as void success (logout)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await expect(
      logout({ fetch: fetchMock }),
    ).resolves.toBeUndefined();
  });

  it("login posts email/password to /api/auth/login", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ user: { id: "u1", email: "a@b.co" } }),
        { status: 200 },
      ),
    );
    const result = await login("a@b.co", "password1", { fetch: fetchMock });
    expect(result.user.email).toBe("a@b.co");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ email: "a@b.co", password: "password1" }),
      }),
    );
  });
});

const sampleJob = {
  id: "job1",
  userId: "u1",
  kitId: null,
  status: "queued" as const,
  steps: [],
  error: null,
  input: {
    jd: "Senior engineer…",
    company_url: "https://example.com",
    days: 5,
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("createKit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs to /api/kits and marks created on 201", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ job: sampleJob }), { status: 201 }),
    );
    const result = await createKit(
      {
        jd: "Senior engineer…",
        company_url: "https://example.com",
        days: 5,
      },
      { fetch: fetchMock },
    );
    expect(result.created).toBe(true);
    expect(result.job.id).toBe("job1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/kits",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          jd: "Senior engineer…",
          company_url: "https://example.com",
          days: 5,
        }),
      }),
    );
  });

  it("marks created=false on 200 (idempotent existing job)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ job: { ...sampleJob, status: "running" } }),
        { status: 200 },
      ),
    );
    const result = await createKit(
      {
        jd: "Senior engineer…",
        company_url: "https://example.com",
        days: 5,
      },
      { fetch: fetchMock },
    );
    expect(result.created).toBe(false);
    expect(result.job.status).toBe("running");
  });
});

describe("createKitsBatch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs array to /api/kits/batch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          jobs: [{ job: sampleJob, created: true }],
        }),
        { status: 200 },
      ),
    );
    const result = await createKitsBatch(
      [
        {
          jd: "Senior engineer…",
          company_url: "https://example.com",
          days: 5,
        },
      ],
      { fetch: fetchMock },
    );
    expect(result.jobs[0]!.created).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/kits/batch",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    );
  });
});

describe("getJob / retryJob", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("GETs /api/jobs/:id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ job: { ...sampleJob, status: "running" } }),
        { status: 200 },
      ),
    );
    const result = await getJob("job1", { fetch: fetchMock });
    expect(result.job.status).toBe("running");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/jobs/job1",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });

  it("POSTs /api/jobs/:id/retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ job: { ...sampleJob, status: "queued", steps: [] } }),
        { status: 200 },
      ),
    );
    const result = await retryJob("job1", { fetch: fetchMock });
    expect(result.job.status).toBe("queued");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/jobs/job1/retry",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });
});

const sampleKitRecord = {
  id: "kit1",
  userId: "u1",
  version: 1,
  title: "Engineer",
  input: {
    jd: "Senior engineer…",
    company_url: "https://example.com",
    days: 5,
  },
  kit: {
    source: {
      company: "Acme",
      company_url: "https://example.com",
      role: "Engineer",
      location: "Remote",
      jd_chars: 20,
      researched_at: "2026-09-25T00:00:00Z",
      pages_used: [],
    },
    company_brief: {
      summary: "Acme builds widgets.",
      what_they_do: "Widgets",
      sources: [],
    },
    role: {
      title: "Engineer",
      seniority: "senior",
      responsibilities: [],
      requirements: [
        {
          id: "r1",
          text: "Know React",
          kind: "technical",
          priority: "must",
        },
      ],
    },
    questions: [],
    flashcards: [],
    schedule: { days_available: 1, days: [] },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("getKit / patchKit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("GETs /api/kits/:id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ kit: sampleKitRecord }), { status: 200 }),
    );
    const result = await getKit("kit1", { fetch: fetchMock });
    expect(result.kit.id).toBe("kit1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/kits/kit1",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });

  it("PATCHes /api/kits/:id with baseVersion + ops", async () => {
    const updated = { ...sampleKitRecord, version: 2 };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ kit: updated }), { status: 200 }),
    );
    const body = {
      baseVersion: 1,
      ops: [
        {
          op: "update" as const,
          target: "brief" as const,
          set: { summary: "Updated summary" },
        },
        {
          op: "update" as const,
          target: "requirement" as const,
          id: "r1",
          set: { text: "Know React well" },
        },
      ],
    };
    const result = await patchKit("kit1", body, { fetch: fetchMock });
    expect(result.kit.version).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/kits/kit1",
      expect.objectContaining({
        method: "PATCH",
        credentials: "include",
        body: JSON.stringify(body),
      }),
    );
  });

  it("attaches full body on VERSION_CONFLICT for kitFromConflictError", async () => {
    const conflictKit = { ...sampleKitRecord, version: 3 };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "VERSION_CONFLICT",
            message: "Kit was modified; reload and retry.",
          },
          kit: conflictKit,
        }),
        { status: 409 },
      ),
    );
    try {
      await patchKit(
        "kit1",
        {
          baseVersion: 1,
          ops: [
            {
              op: "update",
              target: "brief",
              set: { summary: "stale" },
            },
          ],
        },
        { fetch: fetchMock },
      );
      expect.unreachable("should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
      const e = err as ApiClientError;
      expect(e.code).toBe("VERSION_CONFLICT");
      expect(kitFromConflictError(e)?.version).toBe(3);
    }
  });
});

describe("regenerateKitQuestions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs /api/kits/:id/regenerate with section questions + category", async () => {
    const updated = { ...sampleKitRecord, version: 2 };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          kit: updated,
          briefSkipped: false,
          questionsChanged: true,
        }),
        { status: 200 },
      ),
    );
    const result = await regenerateKitQuestions("kit1", "technical", {
      fetch: fetchMock,
    });
    expect(result.questionsChanged).toBe(true);
    expect(result.kit.version).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/kits/kit1/regenerate",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          section: "questions",
          category: "technical",
        }),
      }),
    );
  });

  it("surfaces VERSION_CONFLICT with kit on regenerate race", async () => {
    const conflictKit = { ...sampleKitRecord, version: 4 };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "VERSION_CONFLICT",
            message: "Kit was modified; reload and retry.",
          },
          kit: conflictKit,
        }),
        { status: 409 },
      ),
    );
    try {
      await regenerateKitQuestions("kit1", "behavioural", {
        fetch: fetchMock,
      });
      expect.unreachable("should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
      expect(kitFromConflictError(err as ApiClientError)?.version).toBe(4);
    }
  });
});

describe("regenerateKitBrief", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs section brief without force by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          kit: sampleKitRecord,
          briefSkipped: true,
          questionsChanged: false,
        }),
        { status: 200 },
      ),
    );
    const result = await regenerateKitBrief("kit1", {}, { fetch: fetchMock });
    expect(result.briefSkipped).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/kits/kit1/regenerate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ section: "brief" }),
      }),
    );
  });

  it("includes force:true when overwriting an edited brief", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          kit: { ...sampleKitRecord, version: 2 },
          briefSkipped: false,
          questionsChanged: false,
        }),
        { status: 200 },
      ),
    );
    await regenerateKitBrief("kit1", { force: true }, { fetch: fetchMock });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/kits/kit1/regenerate",
      expect.objectContaining({
        body: JSON.stringify({ section: "brief", force: true }),
      }),
    );
  });
});

describe("regenerateKitSchedule", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs section schedule only (does not send question/brief fields)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          kit: { ...sampleKitRecord, version: 3 },
          briefSkipped: false,
          questionsChanged: false,
        }),
        { status: 200 },
      ),
    );
    const result = await regenerateKitSchedule("kit1", { fetch: fetchMock });
    expect(result.kit.version).toBe(3);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/kits/kit1/regenerate",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ section: "schedule" }),
      }),
    );
  });
});
