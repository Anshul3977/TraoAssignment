import { LlmProviderError } from "./errors.js";
import { parseRetryAfterMs, parseRetryDelayHintMs } from "./retry.js";
import type { CompleteInput, CompleteResult, LlmProvider, ProviderFailureKind } from "./types.js";

export type GeminiConfig = {
  apiKey: string;
  model: string;
  /** Override for tests. */
  fetch?: typeof fetch;
  endpointBase?: string;
};

type GeminiErrorBody = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: Array<Record<string, unknown>>;
  };
};

function kindFromStatus(status: number): ProviderFailureKind {
  if (status === 429) return "rate_limit";
  if (status === 401 || status === 403) return "auth";
  if (status >= 500) return "server";
  if (status >= 400) return "bad_request";
  return "unknown";
}

function extractRetryDelayMs(body: GeminiErrorBody | undefined, header: string | null): number | undefined {
  const fromHeader = parseRetryAfterMs(header);
  if (fromHeader !== undefined) return fromHeader;
  const details = body?.error?.details;
  if (!Array.isArray(details)) return undefined;
  for (const d of details) {
    const delay = d["retryDelay"];
    if (typeof delay === "string") {
      const ms = parseRetryDelayHintMs(delay);
      if (ms !== undefined) return ms;
    }
  }
  return undefined;
}

function extractText(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const candidates = (data as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return undefined;
  const first = candidates[0] as { content?: { parts?: Array<{ text?: string }> } };
  const parts = first?.content?.parts;
  if (!Array.isArray(parts)) return undefined;
  const texts = parts.map((p) => p?.text ?? "").filter(Boolean);
  return texts.length ? texts.join("") : undefined;
}

export function createGeminiProvider(config: GeminiConfig): LlmProvider {
  const fetchFn = config.fetch ?? fetch;
  const base =
    config.endpointBase ?? "https://generativelanguage.googleapis.com/v1beta/models";

  return {
    id: "gemini",
    model: config.model,
    async complete(input: CompleteInput, init?: { signal?: AbortSignal }): Promise<CompleteResult> {
      const json = input.json !== false;
      const url = `${base}/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;
      const body = {
        systemInstruction: { parts: [{ text: input.system }] },
        contents: [{ role: "user", parts: [{ text: input.user }] }],
        generationConfig: json ? { responseMimeType: "application/json" } : {},
      };

      let res: Response;
      try {
        res = await fetchFn(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: init?.signal,
        });
      } catch (cause) {
        throw new LlmProviderError("gemini network error", {
          kind: "network",
          provider: "gemini",
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
        const errBody = parsed as GeminiErrorBody | undefined;
        const message = errBody?.error?.message ?? `gemini HTTP ${res.status}`;
        throw new LlmProviderError(message, {
          kind: kindFromStatus(res.status),
          provider: "gemini",
          status: res.status,
          retryAfterMs: extractRetryDelayMs(errBody, res.headers.get("retry-after")),
        });
      }

      const text = extractText(parsed);
      if (!text) {
        throw new LlmProviderError("gemini empty response", {
          kind: "empty",
          provider: "gemini",
          status: res.status,
        });
      }

      return { text, provider: "gemini", model: config.model };
    },
  };
}
