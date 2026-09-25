import { describe, expect, it } from "vitest";
import { createLlmClient } from "../llm/client.js";
import { TokenRequestLimiter } from "../llm/limiter.js";
import type {
  CompleteInput,
  CompleteResult,
  LlmProvider,
  ProviderId,
} from "../llm/types.js";
import type { Question, Requirement } from "../schema/index.js";
import {
  fallbackQuestionFor,
  generateQuestionsForGaps,
  runCoverageLoop,
} from "./coverageLoop.js";
import { CATEGORY_PROMPTS } from "./generateQuestions.js";

function fakeProvider(
  id: ProviderId,
  impl: (
    input: CompleteInput,
    call: number,
  ) => Promise<CompleteResult> | CompleteResult,
): LlmProvider & {
  calls: number;
  inputs: CompleteInput[];
} {
  const provider = {
    id,
    model: `${id}-test`,
    calls: 0,
    inputs: [] as CompleteInput[],
    async complete(input: CompleteInput): Promise<CompleteResult> {
      provider.calls += 1;
      provider.inputs.push(input);
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

function jsonResult(obj: unknown): CompleteResult {
  return {
    text: JSON.stringify(obj),
    provider: "gemini",
    model: "gemini-test",
  };
}

const REQS: Requirement[] = [
  {
    id: "r1",
    text: "5+ years React",
    kind: "technical",
    priority: "must",
  },
  {
    id: "r2",
    text: "Experience mentoring juniors",
    kind: "behavioural",
    priority: "must",
  },
  {
    id: "r3",
    text: "Familiarity with GraphQL",
    kind: "domain",
    priority: "nice",
  },
];

function draftCovering(ids: string[]): Question[] {
  return ids.map((rid, i) => ({
    id: `q${i + 1}`,
    requirement_ids: [rid],
    category: rid === "r2" ? ("behavioural" as const) : ("technical" as const),
    prompt: `Draft for ${rid}`,
    answer_outline: "outline",
    difficulty: 2 as const,
    meta: { origin: "generated" },
  }));
}

describe("fallbackQuestionFor", () => {
  it("sets meta.origin to fallback and covers the requirement", () => {
    const q = fallbackQuestionFor(REQS[0]!);
    expect(q.meta).toEqual({ origin: "fallback" });
    expect(q.requirement_ids).toEqual(["r1"]);
    expect(q.category).toBe("technical");
    expect(q.prompt).toContain("React");
  });

  it("routes behavioural kinds to behavioural category", () => {
    const q = fallbackQuestionFor(REQS[1]!);
    expect(q.category).toBe("behavioural");
  });
});

describe("generateQuestionsForGaps", () => {
  it("routes by kind to separate category prompts", async () => {
    const provider = fakeProvider("gemini", (input) => {
      if (input.system === CATEGORY_PROMPTS.technical.system) {
        return jsonResult({
          questions: [
            {
              requirement_ids: ["r1"],
              prompt: "Tech gap Q",
              answer_outline: "a",
              difficulty: 2,
            },
          ],
        });
      }
      if (input.system === CATEGORY_PROMPTS.behavioural.system) {
        return jsonResult({
          questions: [
            {
              requirement_ids: ["r2"],
              prompt: "Beh gap Q",
              answer_outline: "STAR",
              difficulty: 2,
            },
          ],
        });
      }
      throw new Error(`unexpected system: ${input.system.slice(0, 40)}`);
    });
    const client = testClient(provider);
    const out = await generateQuestionsForGaps(client, [REQS[0]!, REQS[1]!], {
      seniority: "mid",
    });
    expect(provider.calls).toBe(2);
    expect(out.map((q) => q.category).sort()).toEqual([
      "behavioural",
      "technical",
    ]);
    expect(
      provider.inputs.some(
        (i) => i.system === CATEGORY_PROMPTS["system-design"].system,
      ),
    ).toBe(false);
  });
});

describe("runCoverageLoop", () => {
  it("closes a must-gap on pass 2 and records passes=2", async () => {
    // Draft covers r1 only; r2 is the must-gap.
    const draft = draftCovering(["r1"]);
    const provider = fakeProvider("gemini", (input) => {
      expect(input.system).toBe(CATEGORY_PROMPTS.behavioural.system);
      return jsonResult({
        questions: [
          {
            requirement_ids: ["r2"],
            prompt: "Tell me about mentoring",
            answer_outline: "STAR mentoring",
            difficulty: 2,
          },
        ],
      });
    });
    const client = testClient(provider);

    const result = await runCoverageLoop(client, {
      requirements: REQS,
      draftQuestions: draft,
      seniority: "mid",
    });

    expect(result.coverage.passes).toBe(2);
    expect(result.coverage.uncovered_requirement_ids).toEqual(["r3"]);
    expect(provider.calls).toBe(1);
    expect(result.questions.some((q) => q.requirement_ids.includes("r2"))).toBe(
      true,
    );
    expect(result.research_log.coverage_passes).toHaveLength(2);
    expect(result.research_log.coverage_passes[0]).toMatchObject({
      pass: 1,
      origin: "draft",
      must_gaps: ["r2"],
    });
    expect(result.research_log.coverage_passes[1]).toMatchObject({
      pass: 2,
      origin: "generated",
      must_gaps: [],
    });
  });

  it("adds deterministic fallback after stubborn gaps at pass 3", async () => {
    const draft = draftCovering(["r1"]);
    // Always refuse to cover r2.
    const provider = fakeProvider("gemini", () =>
      jsonResult({
        questions: [
          {
            requirement_ids: ["r1"],
            prompt: "Wrong cover",
            answer_outline: "a",
            difficulty: 1,
          },
        ],
      }),
    );
    const client = testClient(provider);

    const result = await runCoverageLoop(client, {
      requirements: REQS,
      draftQuestions: draft,
      seniority: "mid",
    });

    expect(result.coverage.passes).toBe(3);
    // Two regen LLM passes (pass 2 and 3); behavioural only.
    expect(provider.calls).toBe(2);
    const fallback = result.questions.find(
      (q) => q.meta?.origin === "fallback",
    );
    expect(fallback).toBeDefined();
    expect(fallback!.requirement_ids).toEqual(["r2"]);
    expect(result.coverage.uncovered_requirement_ids).toEqual(["r3"]);
    expect(
      result.research_log.coverage_passes.some((p) => p.origin === "fallback"),
    ).toBe(true);
  });

  it("does not loop when only nice gaps remain", async () => {
    const draft = draftCovering(["r1", "r2"]);
    const provider = fakeProvider("gemini", () => {
      throw new Error("LLM must not be called for nice-only gaps");
    });
    const client = testClient(provider);

    const result = await runCoverageLoop(client, {
      requirements: REQS,
      draftQuestions: draft,
      seniority: "mid",
    });

    expect(result.coverage.passes).toBe(1);
    expect(provider.calls).toBe(0);
    expect(result.coverage.uncovered_requirement_ids).toEqual(["r3"]);
    expect(result.research_log.coverage_passes).toHaveLength(1);
    expect(result.research_log.coverage_passes[0]!.origin).toBe("draft");
    expect(result.questions.every((q) => q.meta?.origin !== "fallback")).toBe(
      true,
    );
  });

  it("records correct passes when draft already covers all musts", async () => {
    const draft = draftCovering(["r1", "r2", "r3"]);
    const provider = fakeProvider("gemini", () => {
      throw new Error("no LLM");
    });
    const client = testClient(provider);

    const result = await runCoverageLoop(client, {
      requirements: REQS,
      draftQuestions: draft,
      seniority: "mid",
    });

    expect(result.coverage.passes).toBe(1);
    expect(result.coverage.uncovered_requirement_ids).toEqual([]);
    expect(result.research_log.coverage_passes[0]!.must_gaps).toEqual([]);
  });
});
