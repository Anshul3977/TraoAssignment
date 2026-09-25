import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createLlmClient } from "./client.js";
import { LlmError } from "./errors.js";
import { generateJson, parseJsonText } from "./generateJson.js";
import { llmCacheKey, readLlmCache, writeLlmCache } from "./cache.js";
import { TokenRequestLimiter } from "./limiter.js";
import type { CompleteInput, CompleteResult, LlmProvider, ProviderId } from "./types.js";

function fakeProvider(
  id: ProviderId,
  impl: (input: CompleteInput, call: number) => Promise<CompleteResult> | CompleteResult,
): LlmProvider & { calls: number; lastInput?: CompleteInput } {
  const provider = {
    id,
    model: `${id}-test`,
    calls: 0,
    lastInput: undefined as CompleteInput | undefined,
    async complete(input: CompleteInput): Promise<CompleteResult> {
      provider.calls += 1;
      provider.lastInput = input;
      return impl(input, provider.calls);
    },
  };
  return provider;
}

function testClient(primary: LlmProvider) {
  return createLlmClient({
    primary,
    limiter: new TokenRequestLimiter({
      requestsPerMinute: 1000,
      tokensPerMinute: 1_000_000,
      sleep: async () => undefined,
    }),
    retry: { maxAttempts: 1, sleep: async () => undefined, random: () => 0 },
  });
}

const SampleSchema = z.object({
  title: z.string(),
  count: z.number().int(),
});

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("parseJsonText", () => {
  it("parses bare JSON and fenced JSON", () => {
    expect(parseJsonText('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonText('```json\n{"a":2}\n```')).toEqual({ a: 2 });
  });
});

describe("generateJson", () => {
  it("returns typed data when the first response is valid", async () => {
    const primary = fakeProvider("gemini", () => ({
      text: JSON.stringify({ title: "ok", count: 3 }),
      provider: "gemini",
      model: "gemini-test",
    }));
    const data = await generateJson(
      testClient(primary),
      {
        system: "sys",
        parts: ["part-a"],
        schema: SampleSchema,
        label: "sample",
      },
      { cacheDir: false },
    );
    expect(data).toEqual({ title: "ok", count: 3 });
    expect(primary.calls).toBe(1);
  });

  it("repairs invalid JSON on the second call", async () => {
    const primary = fakeProvider("gemini", (_input, call) => {
      if (call === 1) {
        return {
          text: "not-json-at-all",
          provider: "gemini",
          model: "gemini-test",
        };
      }
      return {
        text: JSON.stringify({ title: "fixed", count: 1 }),
        provider: "gemini",
        model: "gemini-test",
      };
    });

    const data = await generateJson(
      testClient(primary),
      {
        system: "Return a title and count",
        parts: ["context"],
        schema: SampleSchema,
        label: "repair-demo",
      },
      { cacheDir: false },
    );

    expect(data).toEqual({ title: "fixed", count: 1 });
    expect(primary.calls).toBe(2);
    expect(primary.lastInput?.user).toContain("JSON parse error");
    expect(primary.lastInput?.user).toContain("not-json-at-all");
    expect(primary.lastInput?.user).toContain('step "repair-demo"');
  });

  it("repairs when JSON parses but fails zod, including zod errors in the repair prompt", async () => {
    const primary = fakeProvider("gemini", (_input, call) => {
      if (call === 1) {
        return {
          text: JSON.stringify({ title: "x", count: "nope" }),
          provider: "gemini",
          model: "gemini-test",
        };
      }
      return {
        text: JSON.stringify({ title: "x", count: 2 }),
        provider: "gemini",
        model: "gemini-test",
      };
    });

    const data = await generateJson(
      testClient(primary),
      {
        system: "sys",
        parts: ["p"],
        schema: SampleSchema,
        label: "zod-repair",
      },
      { cacheDir: false },
    );

    expect(data.count).toBe(2);
    expect(primary.calls).toBe(2);
    expect(primary.lastInput?.user).toContain("Schema validation errors");
    expect(primary.lastInput?.user).toMatch(/count:/);
  });

  it("throws LlmError when repair still fails", async () => {
    const primary = fakeProvider("gemini", () => ({
      text: "still-broken",
      provider: "gemini",
      model: "gemini-test",
    }));

    await expect(
      generateJson(
        testClient(primary),
        {
          system: "sys",
          parts: ["p"],
          schema: SampleSchema,
          label: "always-fail",
        },
        { cacheDir: false },
      ),
    ).rejects.toMatchObject({
      name: "LlmError",
      label: "always-fail",
    });

    expect(primary.calls).toBe(2);
  });

  it("throws LlmError when the provider always fails", async () => {
    const primary = fakeProvider("gemini", () => {
      throw new Error("network down");
    });

    let caught: unknown;
    try {
      await generateJson(
        testClient(primary),
        {
          system: "sys",
          parts: ["p"],
          schema: SampleSchema,
          label: "down",
        },
        { cacheDir: false },
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(LlmError);
    expect((caught as LlmError).label).toBe("down");
    expect((caught as LlmError).message).toContain("LLM call failed");
  });

  it("reads and writes disk cache when cacheDir is set", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "llm-cache-"));
    tempDirs.push(dir);

    let liveCalls = 0;
    const primary = fakeProvider("gemini", () => {
      liveCalls += 1;
      return {
        text: JSON.stringify({ title: "cached", count: 9 }),
        provider: "gemini",
        model: "gemini-test",
      };
    });
    const client = testClient(primary);

    const args = {
      system: "sys",
      parts: ["unique-parts"],
      schema: SampleSchema,
      label: "cache-demo",
    };

    const first = await generateJson(client, args, { cacheDir: dir });
    expect(first).toEqual({ title: "cached", count: 9 });
    expect(liveCalls).toBe(1);

    const key = llmCacheKey(
      "gemini",
      "gemini-test",
      `${args.system}\n\n${args.parts.join("\n\n")}`,
    );
    const onDisk = await readFile(path.join(dir, `${key}.json`), "utf8");
    expect(JSON.parse(onDisk).text).toContain("cached");

    const second = await generateJson(client, args, { cacheDir: dir });
    expect(second).toEqual({ title: "cached", count: 9 });
    expect(liveCalls).toBe(1);
  });

  it("does not use cache in production even if LLM_CACHE_DIR is set", async () => {
    let liveCalls = 0;
    const primary = fakeProvider("gemini", () => {
      liveCalls += 1;
      return {
        text: JSON.stringify({ title: "prod", count: 1 }),
        provider: "gemini",
        model: "gemini-test",
      };
    });

    await generateJson(
      testClient(primary),
      {
        system: "sys",
        parts: ["p"],
        schema: SampleSchema,
        label: "prod",
      },
      {
        env: { NODE_ENV: "production", LLM_CACHE_DIR: "/tmp/should-not-use" },
      },
    );
    expect(liveCalls).toBe(1);
  });
});

describe("llmCacheKey", () => {
  it("is stable and sensitive to prompt changes", () => {
    const a = llmCacheKey("gemini", "m", "hello");
    const b = llmCacheKey("gemini", "m", "hello");
    const c = llmCacheKey("gemini", "m", "hello!");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("round-trips write/read", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "llm-cache-rw-"));
    tempDirs.push(dir);
    const key = llmCacheKey("groq", "m", "p");
    await writeLlmCache(dir, key, '{"ok":true}');
    const hit = await readLlmCache(dir, key);
    expect(hit?.text).toBe('{"ok":true}');
  });
});
