/** Provider ids supported by T08a. */
export type ProviderId = "gemini" | "groq";

export type CompleteInput = {
  system: string;
  user: string;
  /** Request JSON response mode from the underlying API when true (default true). */
  json?: boolean;
};

export type CompleteResult = {
  text: string;
  provider: ProviderId;
  model: string;
};

/** Injectable provider — real Gemini/Groq or fakes in tests. */
export interface LlmProvider {
  readonly id: ProviderId;
  readonly model: string;
  complete(input: CompleteInput, init?: { signal?: AbortSignal }): Promise<CompleteResult>;
}

export type RetryableKind = "rate_limit" | "server" | "network";

export type ProviderFailureKind = RetryableKind | "auth" | "bad_request" | "empty" | "unknown";
