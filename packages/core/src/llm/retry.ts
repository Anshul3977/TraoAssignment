import { isLlmProviderError, isRetryableKind, LlmProviderError } from "./errors.js";
import type { SleepFn } from "./limiter.js";

export type RetryOptions = {
  /** Max attempts per provider (default 6). */
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Injected for deterministic jitter in tests. */
  random?: () => number;
  sleep?: SleepFn;
};

const DEFAULT_MAX_ATTEMPTS = 6;
const DEFAULT_BASE_MS = 500;
const DEFAULT_MAX_MS = 30_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parse Retry-After: delta-seconds or HTTP-date. Returns ms, or undefined. */
export function parseRetryAfterMs(header: string | null | undefined, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (!trimmed) return undefined;
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Math.max(0, Math.ceil(Number(trimmed) * 1000));
  }
  const when = Date.parse(trimmed);
  if (!Number.isNaN(when)) return Math.max(0, when - now);
  return undefined;
}

/** Parse Google-style "5s" / "1.5s" retryDelay strings. */
export function parseRetryDelayHintMs(hint: string | null | undefined): number | undefined {
  if (!hint) return undefined;
  const m = /^(\d+(?:\.\d+)?)\s*s$/i.exec(hint.trim());
  if (!m?.[1]) return undefined;
  return Math.max(0, Math.ceil(Number(m[1]) * 1000));
}

export function computeBackoffMs(
  attemptIndex: number,
  opts: {
    baseDelayMs?: number;
    maxDelayMs?: number;
    random?: () => number;
    retryAfterMs?: number;
  } = {},
): number {
  if (opts.retryAfterMs !== undefined && opts.retryAfterMs >= 0) {
    // Honour server hint, still cap.
    const max = opts.maxDelayMs ?? DEFAULT_MAX_MS;
    return Math.min(max, opts.retryAfterMs);
  }
  const base = opts.baseDelayMs ?? DEFAULT_BASE_MS;
  const max = opts.maxDelayMs ?? DEFAULT_MAX_MS;
  const random = opts.random ?? Math.random;
  const exp = Math.min(max, base * 2 ** attemptIndex);
  const jitter = exp * (0.5 + random() * 0.5); // 50–100% of exp
  return Math.min(max, Math.floor(jitter));
}

export function isRetryableError(err: unknown): boolean {
  if (isLlmProviderError(err)) return isRetryableKind(err.kind);
  return false;
}

/**
 * Retry `fn` on rate_limit / server / network errors with exponential backoff + jitter.
 * Honours `retryAfterMs` on LlmProviderError when present.
 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const sleep = opts.sleep ?? defaultSleep;
  let lastErr: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      const retryable = isRetryableError(err);
      const isLast = attempt >= maxAttempts - 1;
      if (!retryable || isLast) throw err;
      const retryAfterMs = isLlmProviderError(err) ? err.retryAfterMs : undefined;
      const delay = computeBackoffMs(attempt, {
        baseDelayMs: opts.baseDelayMs,
        maxDelayMs: opts.maxDelayMs,
        random: opts.random,
        retryAfterMs,
      });
      await sleep(delay);
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new LlmProviderError("retry exhausted", { kind: "unknown", cause: lastErr });
}
