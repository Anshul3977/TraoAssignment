import dns from "node:dns/promises";
import { waitForHostSlot, sleep } from "./hostLimiter.js";
import { isPrivateOrLocalIp } from "./privateAddress.js";
import { isAllowedByRobots, USER_AGENT } from "./robots.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;
const MAX_ATTEMPTS = 4;

const ALLOWED_CONTENT_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "text/plain",
  "application/xml",
  "text/xml",
]);

export type SafeFetchOk = {
  ok: true;
  url: string;
  status: number;
  contentType: string;
  body: string;
  finalUrl: string;
};

export type SafeFetchErr = {
  ok: false;
  url: string;
  reason: string;
  status?: number;
};

export type SafeFetchResult = SafeFetchOk | SafeFetchErr;

export type SafeFetchOptions = {
  /** Override production SSRF block for this call (CLI / fixtures). */
  allowPrivateHosts?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Skip robots.txt (used when fetching robots.txt itself). */
  skipRobots?: boolean;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  /** Injectable DNS lookup for tests. */
  lookup?: (hostname: string) => Promise<string[]>;
};

function envAllowsPrivate(): boolean {
  return process.env.ALLOW_PRIVATE_HOSTS === "true";
}

function shouldBlockPrivate(opts: SafeFetchOptions): boolean {
  if (opts.allowPrivateHosts === true) return false;
  if (envAllowsPrivate()) return false;
  // SPEC §11 / rule 10: only enforce in production
  return process.env.NODE_ENV === "production";
}

async function defaultLookup(hostname: string): Promise<string[]> {
  // If the "hostname" is already an IP, return it
  if (isIpLiteral(hostname)) return [hostname];
  const results = await dns.lookup(hostname, { all: true, verbatim: true });
  return results.map((r) => r.address);
}

function isIpLiteral(host: string): boolean {
  // Strip brackets from IPv6 URLs
  const h = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  return isPrivateOrLocalIp(h) || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":");
}

function parseHttpUrl(raw: string): URL | SafeFetchErr {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, url: raw, reason: "invalid_url" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, url: raw, reason: "unsupported_protocol" };
  }
  return parsed;
}

async function assertHostAllowed(
  url: URL,
  opts: SafeFetchOptions,
): Promise<SafeFetchErr | null> {
  if (!shouldBlockPrivate(opts)) return null;

  const host = url.hostname.startsWith("[") && url.hostname.endsWith("]")
    ? url.hostname.slice(1, -1)
    : url.hostname;

  // IP literals are checked directly — never trust a custom lookup to rewrite them.
  if (isIpLiteral(host)) {
    if (isPrivateOrLocalIp(host)) {
      return { ok: false, url: url.href, reason: "private_address_blocked" };
    }
    return null;
  }

  const lookup = opts.lookup ?? defaultLookup;
  let addresses: string[];
  try {
    addresses = await lookup(host);
  } catch {
    return { ok: false, url: url.href, reason: "dns_failed" };
  }

  if (addresses.length === 0) {
    return { ok: false, url: url.href, reason: "dns_failed" };
  }

  for (const addr of addresses) {
    if (isPrivateOrLocalIp(addr)) {
      return { ok: false, url: url.href, reason: "private_address_blocked" };
    }
  }
  return null;
}

function contentTypeAllowed(header: string | null): boolean {
  if (!header) return false;
  const base = header.split(";")[0]?.trim().toLowerCase() ?? "";
  return ALLOWED_CONTENT_TYPES.has(base);
}

async function readBodyLimited(
  res: Response,
  maxBytes: number,
): Promise<{ ok: true; body: string } | { ok: false; reason: string }> {
  if (!res.body) {
    return { ok: true, body: "" };
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "response_too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "network_error" };
  }

  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return { ok: true, body: buf.toString("utf8") };
}

function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const asNum = Number(header);
  if (!Number.isNaN(asNum) && asNum >= 0) {
    return Math.min(asNum * 1000, 60_000);
  }
  const when = Date.parse(header);
  if (!Number.isNaN(when)) {
    return Math.min(Math.max(0, when - Date.now()), 60_000);
  }
  return null;
}

function backoffMs(attempt: number, retryAfterMs: number | null): number {
  if (retryAfterMs !== null) return retryAfterMs;
  const base = 200 * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 100);
  return Math.min(base + jitter, 8_000);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

type AttemptOutcome =
  | { kind: "ok"; result: SafeFetchOk }
  | { kind: "fail"; result: SafeFetchErr }
  | { kind: "retry"; status?: number; retryAfterMs: number | null; reason: string };

/**
 * Fetch a URL with SSRF guards, size/type limits, robots, per-host rate limit, and retry.
 * Never throws for remote failures — returns `{ ok:false, reason, ... }`.
 */
export async function safeFetch(
  inputUrl: string,
  opts: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

  const initial = parseHttpUrl(inputUrl);
  if (!(initial instanceof URL)) return initial;

  if (!opts.skipRobots) {
    const allowed = await isAllowedByRobots(initial, async (robotsUrl) => {
      const r = await safeFetch(robotsUrl, {
        ...opts,
        skipRobots: true,
        // robots.txt is often text/plain; keep same guards
      });
      if (!r.ok) return null;
      return r.body;
    });
    if (!allowed) {
      return { ok: false, url: initial.href, reason: "robots_disallowed" };
    }
  }

  let attempt = 0;
  while (attempt < MAX_ATTEMPTS) {
    const outcome = await attemptFetch(initial.href, {
      fetchImpl,
      timeoutMs,
      maxBytes,
      maxRedirects,
      opts,
    });

    if (outcome.kind === "ok") return outcome.result;
    if (outcome.kind === "fail") return outcome.result;

    attempt += 1;
    if (attempt >= MAX_ATTEMPTS) {
      return {
        ok: false,
        url: initial.href,
        reason: outcome.reason,
        status: outcome.status,
      };
    }
    await sleep(backoffMs(attempt - 1, outcome.retryAfterMs));
  }

  return { ok: false, url: initial.href, reason: "retries_exhausted" };
}

async function attemptFetch(
  startUrl: string,
  ctx: {
    fetchImpl: typeof fetch;
    timeoutMs: number;
    maxBytes: number;
    maxRedirects: number;
    opts: SafeFetchOptions;
  },
): Promise<AttemptOutcome> {
  let current = parseHttpUrl(startUrl);
  if (!(current instanceof URL)) return { kind: "fail", result: current };

  for (let hop = 0; hop <= ctx.maxRedirects; hop++) {
    const blocked = await assertHostAllowed(current, ctx.opts);
    if (blocked) return { kind: "fail", result: blocked };

    await waitForHostSlot(current.hostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);

    let res: Response;
    try {
      res = await ctx.fetchImpl(current.href, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html, application/xhtml+xml, text/plain, application/xml, text/xml, */*;q=0.1",
        },
      });
    } catch (err) {
      clearTimeout(timer);
      const name = err instanceof Error ? err.name : "";
      if (name === "AbortError") {
        return { kind: "fail", result: { ok: false, url: current.href, reason: "timeout" } };
      }
      return {
        kind: "retry",
        reason: "network_error",
        retryAfterMs: null,
      };
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) {
        return {
          kind: "fail",
          result: { ok: false, url: current.href, reason: "redirect_missing_location", status: res.status },
        };
      }
      if (hop === ctx.maxRedirects) {
        return {
          kind: "fail",
          result: { ok: false, url: current.href, reason: "too_many_redirects", status: res.status },
        };
      }
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return {
          kind: "fail",
          result: { ok: false, url: current.href, reason: "invalid_redirect", status: res.status },
        };
      }
      if (next.protocol !== "http:" && next.protocol !== "https:") {
        return {
          kind: "fail",
          result: { ok: false, url: next.href, reason: "unsupported_protocol", status: res.status },
        };
      }
      current = next;
      continue;
    }

    if (isRetryableStatus(res.status)) {
      return {
        kind: "retry",
        status: res.status,
        reason: res.status === 429 ? "http_429" : "http_5xx",
        retryAfterMs: parseRetryAfterMs(res.headers.get("retry-after")),
      };
    }

    if (res.status === 404) {
      return {
        kind: "fail",
        result: { ok: false, url: current.href, reason: "http_error", status: 404 },
      };
    }

    if (res.status < 200 || res.status >= 300) {
      return {
        kind: "fail",
        result: { ok: false, url: current.href, reason: "http_error", status: res.status },
      };
    }

    const contentType = res.headers.get("content-type");
    if (!contentTypeAllowed(contentType)) {
      // Drain / cancel body to free the socket
      await res.body?.cancel().catch(() => undefined);
      return {
        kind: "fail",
        result: {
          ok: false,
          url: current.href,
          reason: "unsupported_content_type",
          status: res.status,
        },
      };
    }

    const bodyResult = await readBodyLimited(res, ctx.maxBytes);
    if (!bodyResult.ok) {
      return {
        kind: "fail",
        result: { ok: false, url: current.href, reason: bodyResult.reason, status: res.status },
      };
    }

    return {
      kind: "ok",
      result: {
        ok: true,
        url: startUrl,
        finalUrl: current.href,
        status: res.status,
        contentType: contentType!.split(";")[0]!.trim().toLowerCase(),
        body: bodyResult.body,
      },
    };
  }

  return {
    kind: "fail",
    result: { ok: false, url: startUrl, reason: "too_many_redirects" },
  };
}
