import { describe, expect, it } from "vitest";
import { createGeminiProvider } from "./gemini.js";
import { createGroqProvider } from "./groq.js";
import { computeBackoffMs, parseRetryAfterMs, parseRetryDelayHintMs } from "./retry.js";
import { createProvidersFromEnv } from "./config.js";

describe("retry helpers", () => {
  it("parses Retry-After delta-seconds and HTTP-date", () => {
    expect(parseRetryAfterMs("2")).toBe(2000);
    expect(parseRetryAfterMs("1.5")).toBe(1500);
    const now = Date.parse("Wed, 21 Oct 2015 07:28:00 GMT");
    expect(parseRetryAfterMs("Wed, 21 Oct 2015 07:28:05 GMT", now)).toBe(5000);
  });

  it("parses Gemini retryDelay hints", () => {
    expect(parseRetryDelayHintMs("5s")).toBe(5000);
    expect(parseRetryDelayHintMs("1.5s")).toBe(1500);
  });

  it("applies exponential backoff with jitter bounds", () => {
    expect(computeBackoffMs(0, { baseDelayMs: 100, random: () => 0 })).toBe(50);
    expect(computeBackoffMs(0, { baseDelayMs: 100, random: () => 1 })).toBe(100);
    expect(computeBackoffMs(0, { retryAfterMs: 2500, maxDelayMs: 10_000 })).toBe(2500);
  });
});

describe("createProvidersFromEnv", () => {
  it("uses groq as fallback when primary is gemini", () => {
    const { primary, fallback } = createProvidersFromEnv({
      LLM_PROVIDER: "gemini",
      GEMINI_API_KEY: "g-key",
      GEMINI_MODEL: "gemini-2.0-flash",
      GROQ_API_KEY: "q-key",
      GROQ_MODEL: "llama-test",
    });
    expect(primary.id).toBe("gemini");
    expect(fallback?.id).toBe("groq");
  });

  it("throws LlmNotConfiguredError when primary key is missing", () => {
    expect(() =>
      createProvidersFromEnv({ LLM_PROVIDER: "gemini", GROQ_API_KEY: "only-groq" }),
    ).toThrow(/GEMINI_API_KEY is not set/);
    try {
      createProvidersFromEnv({ LLM_PROVIDER: "gemini" });
    } catch (err) {
      expect(err).toMatchObject({ code: "LLM_NOT_CONFIGURED", name: "LlmNotConfiguredError" });
    }
  });
});

describe("gemini provider (mocked fetch)", () => {
  it("posts JSON mode and returns candidate text", async () => {
    const fetchMock: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.generationConfig.responseMimeType).toBe("application/json");
      expect(body.generationConfig.temperature).toBe(0);
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const provider = createGeminiProvider({
      apiKey: "k",
      model: "gemini-2.0-flash",
      fetch: fetchMock,
    });
    const result = await provider.complete({ system: "sys", user: "hi" });
    expect(result).toEqual({
      text: '{"a":1}',
      provider: "gemini",
      model: "gemini-2.0-flash",
    });
  });

  it("maps 429 + retryDelay detail", async () => {
    const fetchMock: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 429,
            message: "resource exhausted",
            details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "3s" }],
          },
        }),
        { status: 429, headers: { "content-type": "application/json" } },
      );

    const provider = createGeminiProvider({ apiKey: "k", model: "m", fetch: fetchMock });
    await expect(provider.complete({ system: "s", user: "u" })).rejects.toMatchObject({
      kind: "rate_limit",
      status: 429,
      retryAfterMs: 3000,
    });
  });
});

describe("groq provider (mocked fetch)", () => {
  it("uses OpenAI-compatible chat completions + json_object", async () => {
    const fetchMock: typeof fetch = async (_url, init) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers.authorization).toBe("Bearer gk");
      const body = JSON.parse(String(init?.body));
      expect(body.response_format).toEqual({ type: "json_object" });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"b":2}' } }],
        }),
        { status: 200 },
      );
    };

    const provider = createGroqProvider({
      apiKey: "gk",
      model: "llama-test",
      fetch: fetchMock,
    });
    const result = await provider.complete({ system: "sys", user: "hi" });
    expect(result.text).toBe('{"b":2}');
    expect(result.provider).toBe("groq");
  });
});
