import { LlmProviderError } from "./errors.js";
import {
  estimateTokens,
  getSharedLimiter,
  type TokenRequestLimiter,
} from "./limiter.js";
import { withRetry, type RetryOptions } from "./retry.js";
import { createProvidersFromEnv, type EnvLike } from "./config.js";
import type { CompleteInput, CompleteResult, LlmProvider } from "./types.js";

export type LlmClient = {
  complete(input: CompleteInput, init?: { signal?: AbortSignal }): Promise<CompleteResult>;
  readonly primary: LlmProvider;
  readonly fallback?: LlmProvider;
};

export type CreateLlmClientOptions = {
  primary: LlmProvider;
  fallback?: LlmProvider;
  limiter?: TokenRequestLimiter;
  retry?: RetryOptions;
};

async function completeThroughProvider(
  provider: LlmProvider,
  input: CompleteInput,
  limiter: TokenRequestLimiter,
  retry: RetryOptions | undefined,
  init?: { signal?: AbortSignal },
): Promise<CompleteResult> {
  const tokens = estimateTokens(input.system, input.user);
  return withRetry(async () => {
    await limiter.acquire(tokens);
    return provider.complete(input, init);
  }, retry);
}

/**
 * Provider client: shared TPM/RPM limiter → retry (≤6) → optional other-provider fallback.
 */
export function createLlmClient(opts: CreateLlmClientOptions): LlmClient {
  const limiter = opts.limiter ?? getSharedLimiter();
  const { primary, fallback, retry } = opts;

  return {
    primary,
    fallback,
    async complete(input, init) {
      try {
        return await completeThroughProvider(primary, input, limiter, retry, init);
      } catch (primaryErr) {
        if (!fallback) throw primaryErr;
        try {
          return await completeThroughProvider(fallback, input, limiter, retry, init);
        } catch (fallbackErr) {
          throw new LlmProviderError(
            `primary (${primary.id}) and fallback (${fallback.id}) both failed`,
            {
              kind: "unknown",
              provider: fallback.id,
              cause: { primary: primaryErr, fallback: fallbackErr },
            },
          );
        }
      }
    },
  };
}

/** Client wired from process env (or injected env map). */
export function createLlmClientFromEnv(
  env: EnvLike = process.env,
  opts?: Omit<CreateLlmClientOptions, "primary" | "fallback">,
): LlmClient {
  const { primary, fallback } = createProvidersFromEnv(env);
  return createLlmClient({ primary, fallback, ...opts });
}
