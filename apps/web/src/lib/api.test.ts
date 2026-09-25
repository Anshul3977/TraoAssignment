import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiClientError,
  apiFetch,
  apiPath,
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
