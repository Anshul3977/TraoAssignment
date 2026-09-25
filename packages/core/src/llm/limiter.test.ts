import { describe, expect, it } from "vitest";
import {
  TokenRequestLimiter,
  estimateTokens,
  resetSharedLimiter,
  getSharedLimiter,
} from "./limiter.js";

describe("estimateTokens", () => {
  it("uses chars/4 rounded up, at least 1", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("")).toBe(1);
    expect(estimateTokens("aa", "bb")).toBe(1);
  });
});

describe("TokenRequestLimiter", () => {
  it("delays when RPM budget is exceeded", async () => {
    const sleeps: number[] = [];
    let now = 1_000_000;
    const limiter = new TokenRequestLimiter({
      requestsPerMinute: 1,
      tokensPerMinute: 100_000,
      windowMs: 60_000,
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    });

    await limiter.acquire(10);
    expect(sleeps).toEqual([]);

    const second = limiter.acquire(10);
    await second;

    expect(sleeps.length).toBeGreaterThanOrEqual(1);
    expect(sleeps[0]).toBeGreaterThan(0);
    expect(limiter.snapshot().requests).toBe(1);
  });

  it("delays when TPM budget would be exceeded", async () => {
    const sleeps: number[] = [];
    let now = 0;
    const limiter = new TokenRequestLimiter({
      requestsPerMinute: 100,
      tokensPerMinute: 100,
      windowMs: 1_000,
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    });

    await limiter.acquire(80);
    await limiter.acquire(40);

    expect(sleeps.length).toBeGreaterThanOrEqual(1);
    expect(sleeps[0]).toBeGreaterThan(0);
  });
});

describe("shared limiter", () => {
  it("resetSharedLimiter clears the singleton", () => {
    resetSharedLimiter();
    const a = getSharedLimiter({ requestsPerMinute: 3, tokensPerMinute: 1000 });
    const b = getSharedLimiter();
    expect(a).toBe(b);
    resetSharedLimiter();
    const c = getSharedLimiter({ requestsPerMinute: 5, tokensPerMinute: 1000 });
    expect(c).not.toBe(a);
    expect(c.requestsPerMinute).toBe(5);
    resetSharedLimiter();
  });
});
