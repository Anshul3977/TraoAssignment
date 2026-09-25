import type { ZodIssue } from "zod";
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

/**
 * Typed failure after JSON parse / zod validation (and optional repair) failed,
 * or when the underlying provider call failed for a labelled generateJson step.
 */
export class LlmError extends Error {
  readonly label: string;
  readonly cause?: unknown;
  readonly zodIssues?: ZodIssue[];
  readonly rawText?: string;
  readonly parseError?: string;

  constructor(
    message: string,
    opts: {
      label: string;
      cause?: unknown;
      zodIssues?: ZodIssue[];
      rawText?: string;
      parseError?: string;
    },
  ) {
    super(message);
    this.name = "LlmError";
    this.label = opts.label;
    this.cause = opts.cause;
    this.zodIssues = opts.zodIssues;
    this.rawText = opts.rawText;
    this.parseError = opts.parseError;
  }
}

export function isRetryableKind(kind: ProviderFailureKind): boolean {
  return kind === "rate_limit" || kind === "server" || kind === "network";
}

export function isLlmProviderError(err: unknown): err is LlmProviderError {
  return err instanceof LlmProviderError;
}

export function isLlmError(err: unknown): err is LlmError {
  return err instanceof LlmError;
}
