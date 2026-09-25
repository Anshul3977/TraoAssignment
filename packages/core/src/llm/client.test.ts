import { describe, expect, it } from "vitest";
import { createLlmClient } from "./client.js";
import { LlmProviderError } from "./errors.js";
import { TokenRequestLimiter } from "./limiter.js";
import type { CompleteInput, CompleteResult, LlmProvider, ProviderId } from "./types.js";

function fakeProvider(
  id: ProviderId,
  impl: (input: CompleteInput, call: number) => Promise<CompleteResult> | CompleteResult,
): LlmProvider & { calls: number } {
  const provider = {
    id,
    model: `${id}-test`,
    calls: 0,
    async complete(input: CompleteInput): Promise<CompleteResult> {
      provider.calls += 1;
      return impl(input, provider.calls);
    },
  };
  return provider;
}

describe("createLlmClient retry", () => {
  it("retries 429 → 429 → ok on the primary", async () => {
    const sleeps: number[] = [];
    const primary = fakeProvider("gemini", (_input, call) => {
      if (call <= 2) {
        throw new LlmProviderError("slow down", {
          kind: "rate_limit",
          provider: "gemini",
          status: 429,
          retryAfterMs: 10,
        });
      }
      return { text: '{"ok":true}', provider: "gemini", model: "gemini-test" };
    });

    const client = createLlmClient({
      primary,
      limiter: new TokenRequestLimiter({
        requestsPerMinute: 100,
        tokensPerMinute: 100_000,
        sleep: async () => undefined,
      }),
      retry: {
        maxAttempts: 6,
        random: () => 0,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    });

    const result = await client.complete({ system: "s", user: "u" });
    expect(result.text).toBe('{"ok":true}');
    expect(primary.calls).toBe(3);
    expect(sleeps).toEqual([10, 10]);
  });
});

describe("createLlmClient fallback", () => {
  it("falls back when primary always fails after retries", async () => {
    const primary = fakeProvider("gemini", () => {
      throw new LlmProviderError("always fail", {
        kind: "server",
        provider: "gemini",
        status: 503,
      });
    });
    const fallback = fakeProvider("groq", () => ({
      text: '{"from":"groq"}',
      provider: "groq",
      model: "groq-test",
    }));

    const client = createLlmClient({
      primary,
      fallback,
      limiter: new TokenRequestLimiter({
        requestsPerMinute: 100,
        tokensPerMinute: 100_000,
        sleep: async () => undefined,
      }),
      retry: {
        maxAttempts: 3,
        random: () => 0,
        sleep: async () => undefined,
      },
    });

    const result = await client.complete({ system: "s", user: "hello" });
    expect(result.provider).toBe("groq");
    expect(result.text).toBe('{"from":"groq"}');
    expect(primary.calls).toBe(3);
    expect(fallback.calls).toBe(1);
  });

  it("surfaces a combined error when both providers fail", async () => {
    const primary = fakeProvider("gemini", () => {
      throw new LlmProviderError("primary down", { kind: "network", provider: "gemini" });
    });
    const fallback = fakeProvider("groq", () => {
      throw new LlmProviderError("fallback down", { kind: "network", provider: "groq" });
    });

    const client = createLlmClient({
      primary,
      fallback,
      limiter: new TokenRequestLimiter({
        requestsPerMinute: 100,
        tokensPerMinute: 100_000,
        sleep: async () => undefined,
      }),
      retry: { maxAttempts: 2, sleep: async () => undefined, random: () => 0 },
    });

    await expect(client.complete({ system: "s", user: "u" })).rejects.toMatchObject({
      name: "LlmProviderError",
      message: expect.stringContaining("both failed"),
    });
  });
});
