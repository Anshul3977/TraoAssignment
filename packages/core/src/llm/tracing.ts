import type { LlmClient } from "./client.js";
import type { ProviderId } from "./types.js";

/** One LLM call as seen by the pipeline (after limiter wait, retries and fallback). */
export type LlmCallTrace = {
  seq: number;
  /** Pipeline step active when the call started (set by the caller). */
  step?: string;
  provider?: ProviderId;
  model?: string;
  ok: boolean;
  ms: number;
  promptTokens?: number;
  completionTokens?: number;
  error?: string;
};

export type TraceSummary = {
  calls: number;
  failed: number;
  llmMs: number;
  promptTokens: number;
  completionTokens: number;
  byStep: Record<string, { calls: number; ms: number; tokens: number }>;
};

/**
 * Wrap a client so every `complete` call is timed and reported. Token counts
 * come from the provider response when it includes usage. Never logs prompts.
 */
export function createTracingClient(
  inner: LlmClient,
  onCall: (call: LlmCallTrace) => void,
  opts: { currentStep?: () => string | undefined; now?: () => number } = {},
): LlmClient {
  const now = opts.now ?? (() => performance.now());
  let seq = 0;
  return {
    primary: inner.primary,
    fallback: inner.fallback,
    async complete(input, init) {
      const id = ++seq;
      const step = opts.currentStep?.();
      const t0 = now();
      try {
        const res = await inner.complete(input, init);
        onCall({
          seq: id,
          step,
          provider: res.provider,
          model: res.model,
          ok: true,
          ms: Math.round(now() - t0),
          promptTokens: res.usage?.promptTokens,
          completionTokens: res.usage?.completionTokens,
        });
        return res;
      } catch (err) {
        onCall({
          seq: id,
          step,
          ok: false,
          ms: Math.round(now() - t0),
          error: err instanceof Error ? err.message.slice(0, 160) : "unknown error",
        });
        throw err;
      }
    },
  };
}

export function summarizeTrace(calls: LlmCallTrace[]): TraceSummary {
  const byStep: TraceSummary["byStep"] = {};
  let llmMs = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let failed = 0;
  for (const c of calls) {
    llmMs += c.ms;
    promptTokens += c.promptTokens ?? 0;
    completionTokens += c.completionTokens ?? 0;
    if (!c.ok) failed++;
    const key = c.step ?? "other";
    const b = (byStep[key] ??= { calls: 0, ms: 0, tokens: 0 });
    b.calls++;
    b.ms += c.ms;
    b.tokens += (c.promptTokens ?? 0) + (c.completionTokens ?? 0);
  }
  return { calls: calls.length, failed, llmMs, promptTokens, completionTokens, byStep };
}
