import type { ProviderFailureKind, ProviderId } from "./types.js";

/** Typed failure from a provider call or after exhausted retries/fallback. */
export class LlmProviderError extends Error {
  readonly kind: ProviderFailureKind;
  readonly provider?: ProviderId;
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly cause?: unknown;

  constructor(
    message: string,
    opts: {
      kind: ProviderFailureKind;
      provider?: ProviderId;
      status?: number;
      retryAfterMs?: number;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = "LlmProviderError";
    this.kind = opts.kind;
    this.provider = opts.provider;
    this.status = opts.status;
    this.retryAfterMs = opts.retryAfterMs;
    this.cause = opts.cause;
  }
}

export function isRetryableKind(kind: ProviderFailureKind): boolean {
  return kind === "rate_limit" || kind === "server" || kind === "network";
}

export function isLlmProviderError(err: unknown): err is LlmProviderError {
  return err instanceof LlmProviderError;
}
