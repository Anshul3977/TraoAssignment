export type {
  CompleteInput,
  CompleteResult,
  LlmProvider,
  ProviderFailureKind,
  ProviderId,
  RetryableKind,
} from "./types.js";

export {
  LlmProviderError,
  LlmError,
  LlmNotConfiguredError,
  isLlmProviderError,
  isLlmError,
  isLlmNotConfiguredError,
  isRetryableKind,
} from "./errors.js";

export {
  TokenRequestLimiter,
  estimateTokens,
  getSharedLimiter,
  resetSharedLimiter,
  setSharedLimiter,
  DEFAULT_LIMITER_OPTIONS,
  type LimiterOptions,
  type SleepFn,
  type NowFn,
} from "./limiter.js";

export {
  withRetry,
  computeBackoffMs,
  parseRetryAfterMs,
  parseRetryDelayHintMs,
  isRetryableError,
  type RetryOptions,
} from "./retry.js";

export { createGeminiProvider, type GeminiConfig } from "./gemini.js";
export { createGroqProvider, type GroqConfig } from "./groq.js";

export {
  resolveLlmEnv,
  createProvidersFromEnv,
  isLlmConfigured,
  missingLlmKeyMessage,
  type EnvLike,
  type ResolvedLlmEnv,
  type ProvidersFromEnv,
} from "./config.js";

export {
  createLlmClient,
  createLlmClientFromEnv,
  type LlmClient,
  type CreateLlmClientOptions,
} from "./client.js";

export {
  wrapUntrusted,
  neutralizeUntrustedClosingTags,
} from "./wrapUntrusted.js";

export {
  generateJson,
  parseJsonText,
  type GenerateJsonArgs,
  type GenerateJsonOptions,
} from "./generateJson.js";

export {
  llmCacheKey,
  resolveLlmCacheDir,
  readLlmCache,
  writeLlmCache,
  type CacheLookup,
} from "./cache.js";
