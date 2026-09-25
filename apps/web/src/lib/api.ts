/**
 * Same-origin API client for docs/API.md (via Next `/api/*` rewrite).
 * Always sends cookies; on 401 redirects to /login?next=…
 */

export type ApiErrorPayload = {
  code: string;
  message: string;
  details?: unknown;
};

export type PublicUser = {
  id: string;
  email: string;
};

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = payload.code;
    this.details = payload.details;
  }
}

/** Map contract path (`/auth/login`) to browser same-origin path (`/api/auth/login`). */
export function apiPath(contractPath: string): string {
  const path = contractPath.startsWith("/") ? contractPath : `/${contractPath}`;
  return `/api${path}`;
}

export function loginRedirectUrl(nextPath: string): string {
  const next = nextPath.startsWith("/") ? nextPath : `/${nextPath}`;
  return `/login?next=${encodeURIComponent(next)}`;
}

export type ApiFetchOptions = RequestInit & {
  /** Skip 401 → /login redirect (e.g. login/register/me probes). */
  skipAuthRedirect?: boolean;
};

type FetchLike = typeof fetch;

export type ApiFetchDeps = {
  fetch?: FetchLike;
  /** Injected for tests; defaults to window.location.assign in the browser. */
  redirectTo?: (url: string) => void;
  /** Injected for tests; defaults to current path+search in the browser. */
  currentPath?: () => string;
};

function defaultRedirectTo(url: string): void {
  if (typeof window !== "undefined") {
    window.location.assign(url);
  }
}

function defaultCurrentPath(): string {
  if (typeof window !== "undefined") {
    return `${window.location.pathname}${window.location.search}`;
  }
  return "/";
}

export async function apiFetch<T = unknown>(
  contractPath: string,
  options: ApiFetchOptions = {},
  deps: ApiFetchDeps = {},
): Promise<T> {
  const {
    skipAuthRedirect = false,
    headers: initHeaders,
    body,
    ...rest
  } = options;
  const doFetch = deps.fetch ?? fetch;
  const redirectTo = deps.redirectTo ?? defaultRedirectTo;
  const currentPath = deps.currentPath ?? defaultCurrentPath;

  const headers = new Headers(initHeaders);
  if (body !== undefined && body !== null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await doFetch(apiPath(contractPath), {
    ...rest,
    body,
    headers,
    credentials: "include",
  });

  if (res.status === 401 && !skipAuthRedirect) {
    redirectTo(loginRedirectUrl(currentPath()));
  }

  if (res.status === 204) {
    return undefined as T;
  }

  let json: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = null;
    }
  }

  if (!res.ok) {
    const errBody =
      json &&
      typeof json === "object" &&
      "error" in json &&
      (json as { error: unknown }).error &&
      typeof (json as { error: ApiErrorPayload }).error === "object"
        ? (json as { error: ApiErrorPayload }).error
        : {
            code: "INTERNAL_ERROR",
            message: res.statusText || "Request failed",
          };
    throw new ApiClientError(res.status, {
      code: errBody.code ?? "INTERNAL_ERROR",
      message: errBody.message ?? "Request failed",
      details: errBody.details,
    });
  }

  return json as T;
}

export async function register(
  email: string,
  password: string,
  deps?: ApiFetchDeps,
): Promise<{ user: PublicUser }> {
  return apiFetch(
    "/auth/register",
    {
      method: "POST",
      body: JSON.stringify({ email, password }),
      skipAuthRedirect: true,
    },
    deps,
  );
}

export async function login(
  email: string,
  password: string,
  deps?: ApiFetchDeps,
): Promise<{ user: PublicUser }> {
  return apiFetch(
    "/auth/login",
    {
      method: "POST",
      body: JSON.stringify({ email, password }),
      skipAuthRedirect: true,
    },
    deps,
  );
}

export async function logout(deps?: ApiFetchDeps): Promise<void> {
  await apiFetch(
    "/auth/logout",
    { method: "POST", skipAuthRedirect: true },
    deps,
  );
}

export async function getMe(
  deps?: ApiFetchDeps,
): Promise<{ user: PublicUser }> {
  return apiFetch("/auth/me", { method: "GET", skipAuthRedirect: true }, deps);
}
