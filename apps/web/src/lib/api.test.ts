import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiClientError,
  apiFetch,
  apiPath,
  createKit,
  login,
  loginRedirectUrl,
  logout,
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
