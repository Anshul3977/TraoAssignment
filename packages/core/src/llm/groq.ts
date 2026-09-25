import { LlmProviderError } from "./errors.js";
import { parseRetryAfterMs } from "./retry.js";
import type { CompleteInput, CompleteResult, LlmProvider, ProviderFailureKind } from "./types.js";

export type GroqConfig = {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
  endpointUrl?: string;
};

type GroqErrorBody = {
  error?: { message?: string; type?: string; code?: string };
};

function kindFromStatus(status: number): ProviderFailureKind {
  if (status === 429) return "rate_limit";
  if (status === 401 || status === 403) return "auth";
  if (status >= 500) return "server";
  if (status >= 400) return "bad_request";
  return "unknown";
}

export function createGroqProvider(config: GroqConfig): LlmProvider {
  const fetchFn = config.fetch ?? fetch;
  const url = config.endpointUrl ?? "https://api.groq.com/openai/v1/chat/completions";

  return {
    id: "groq",
    model: config.model,
    async complete(input: CompleteInput, init?: { signal?: AbortSignal }): Promise<CompleteResult> {
      const json = input.json !== false;
      const body: Record<string, unknown> = {
        model: config.model,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
      };
      if (json) body.response_format = { type: "json_object" };
      body.temperature = 0;

      let res: Response;
      try {
        res = await fetchFn(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: init?.signal,
        });
      } catch (cause) {
        throw new LlmProviderError("groq network error", {
          kind: "network",
          provider: "groq",
          cause,
        });
      }

      const rawText = await res.text();
      let parsed: unknown;
      try {
        parsed = rawText ? JSON.parse(rawText) : undefined;
      } catch {
        parsed = undefined;
      }

      if (!res.ok) {
        const errBody = parsed as GroqErrorBody | undefined;
        const message = errBody?.error?.message ?? `groq HTTP ${res.status}`;
        throw new LlmProviderError(message, {
          kind: kindFromStatus(res.status),
          provider: "groq",
          status: res.status,
          retryAfterMs: parseRetryAfterMs(res.headers.get("retry-after")),
        });
      }

      const text = (parsed as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]
        ?.message?.content;
      if (!text) {
        throw new LlmProviderError("groq empty response", {
          kind: "empty",
          provider: "groq",
          status: res.status,
        });
      }

      return { text, provider: "groq", model: config.model };
    },
  };
}
