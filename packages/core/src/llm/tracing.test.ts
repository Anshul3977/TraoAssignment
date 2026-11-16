import { describe, expect, it } from "vitest";
import type { LlmClient } from "./client.js";
import { createTracingClient, summarizeTrace, type LlmCallTrace } from "./tracing.js";

const provider = { id: "groq" as const, model: "m", complete: async () => ({ text: "", provider: "groq" as const, model: "m" }) };

describe("createTracingClient", () => {
  it("records latency, tokens and step for ok and failed calls", async () => {
    let n = 0;
    const inner: LlmClient = {
      primary: provider,
      async complete() {
        n++;
        if (n === 2) throw new Error("rate limited");
        return { text: "{}", provider: "groq", model: "m", usage: { promptTokens: 100, completionTokens: 20 } };
      },
    };
    const calls: LlmCallTrace[] = [];
    let t = 0;
    let step = "extract";
    const client = createTracingClient(inner, (c) => calls.push(c), {
      currentStep: () => step,
      now: () => (t += 50),
    });
    await client.complete({ system: "s", user: "u" });
    step = "questions";
    await expect(client.complete({ system: "s", user: "u" })).rejects.toThrow("rate limited");
    expect(calls).toEqual([
      { seq: 1, step: "extract", provider: "groq", model: "m", ok: true, ms: 50, promptTokens: 100, completionTokens: 20 },
      { seq: 2, step: "questions", ok: false, ms: 50, error: "rate limited" },
    ]);
    const sum = summarizeTrace(calls);
    expect(sum).toMatchObject({ calls: 2, failed: 1, llmMs: 100, promptTokens: 100, completionTokens: 20 });
    expect(sum.byStep.extract).toEqual({ calls: 1, ms: 50, tokens: 120 });
  });
});
