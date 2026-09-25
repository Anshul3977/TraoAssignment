import { describe, expect, it } from "vitest";
import { createLlmClient } from "../llm/client.js";
import { wrapUntrusted } from "../llm/wrapUntrusted.js";
import { TokenRequestLimiter } from "../llm/limiter.js";
import type {
  CompleteInput,
  CompleteResult,
  LlmProvider,
  ProviderId,
} from "../llm/types.js";
import type { Requirement } from "../schema/index.js";
import type { CompanyBrief } from "./buildBrief.js";
import type { InterviewProcess } from "./extractInterviewProcess.js";
import {
  CATEGORY_PROMPTS,
  clampDifficulty,
  finalizeCategoryQuestions,
  generateQuestions,
  shouldIncludeSystemDesign,
} from "./generateQuestions.js";

function fakeProvider(
  id: ProviderId,
  impl: (input: CompleteInput, call: number) => Promise<CompleteResult> | CompleteResult,
): LlmProvider & {
  calls: number;
  inputs: CompleteInput[];
  lastInput?: CompleteInput;
} {
  const provider = {
    id,
    model: `${id}-test`,
    calls: 0,
    inputs: [] as CompleteInput[],
    lastInput: undefined as CompleteInput | undefined,
    async complete(input: CompleteInput): Promise<CompleteResult> {
      provider.calls += 1;
      provider.inputs.push(input);
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

const ACME_REQS: Requirement[] = [
  {
    id: "r1",
    text: "5+ years of professional experience with React and TypeScript",
    kind: "technical",
    priority: "must",
  },
  {
    id: "r2",
    text: "Strong system design skills for high-traffic web apps",
    kind: "technical",
    priority: "must",
  },
  {
    id: "r3",
    text: "Experience mentoring junior engineers",
    kind: "behavioural",
    priority: "must",
  },
  {
    id: "r4",
    text: "Familiarity with GraphQL",
    kind: "domain",
    priority: "nice",
  },
];

const QUIETCO_REQS: Requirement[] = [
  {
    id: "r1",
    text: "Node and Postgres preferred",
    kind: "technical",
    priority: "must",
  },
];

const ACME_PROCESS: InterviewProcess = {
  found: true,
  stages: [
    { name: "Take-home exercise", type: "take-home" },
    { name: "System-design interview", type: "system-design" },
  ],
  sources: ["http://localhost:8099/acme/handbook/people/how-we-hire.html"],
};

const QUIETCO_PROCESS: InterviewProcess = {
  found: false,
  stages: [],
  sources: [],
};

const ACME_BRIEF: CompanyBrief = {
  summary: "Acme builds collaboration tools for product teams.",
  what_they_do: "Lightweight collaboration software.",
  sources: ["http://localhost:8099/acme/"],
};

const QUIETCO_BRIEF: CompanyBrief = {
  summary: "QuietCo has a homepage only; little public detail.",
  what_they_do: "Unknown beyond the homepage stub.",
  sources: ["http://localhost:8099/quietco/"],
};

function questionPayload(
  items: {
    requirement_ids: string[];
    prompt: string;
    answer_outline: string;
    difficulty: number;
  }[],
): string {
  return JSON.stringify({ questions: items });
}

describe("clampDifficulty / finalizeCategoryQuestions", () => {
  it("clamps difficulty into 1..3 and drops unknown requirement ids", () => {
    expect(clampDifficulty(0)).toBe(1);
    expect(clampDifficulty(9)).toBe(3);
    expect(clampDifficulty(2.4)).toBe(2);

    const finalized = finalizeCategoryQuestions(
      [
        {
          requirement_ids: ["r1", "invented"],
          prompt: "Explain React hooks",
          answer_outline: "hooks overview",
          difficulty: 99,
        },
        {
          requirement_ids: ["nope"],
          prompt: "orphan",
          answer_outline: "x",
          difficulty: 2,
        },
      ],
      "technical",
      new Set(["r1"]),
    );

    expect(finalized).toHaveLength(1);
    expect(finalized[0]!.requirement_ids).toEqual(["r1"]);
    expect(finalized[0]!.difficulty).toBe(3);
    expect(finalized[0]!.meta).toEqual({ origin: "generated" });
  });
});

describe("shouldIncludeSystemDesign", () => {
  it("true for acme (stage + senior + architecture wording)", () => {
    expect(
      shouldIncludeSystemDesign({
        seniority: "senior",
        requirements: ACME_REQS,
        interviewProcess: ACME_PROCESS,
      }),
    ).toBe(true);
  });

  it("false for quietco mid stub without stage or architecture cues", () => {
    expect(
      shouldIncludeSystemDesign({
        seniority: "mid",
        requirements: QUIETCO_REQS,
        interviewProcess: QUIETCO_PROCESS,
      }),
    ).toBe(false);
  });
});

describe("generateQuestions", () => {
  it("makes four separate LLM calls with different instructions (acme)", async () => {
    const primary = fakeProvider("gemini", (input) => {
      if (input.system === CATEGORY_PROMPTS.technical.system) {
        return {
          text: questionPayload([
            {
              requirement_ids: ["r1"],
              prompt: "Walk through your React architecture choices.",
              answer_outline: "components, state, TS",
              difficulty: 2,
            },
            {
              requirement_ids: ["r1"],
              prompt: "How did you approach the take-home exercise?",
              answer_outline: "debrief trade-offs",
              difficulty: 2,
            },
          ]),
          provider: "gemini",
          model: "gemini-test",
        };
      }
      if (input.system === CATEGORY_PROMPTS.behavioural.system) {
        return {
          text: questionPayload([
            {
              requirement_ids: ["r3"],
              prompt: "Tell me about mentoring a junior.",
              answer_outline: "S: … T: … A: … R: …",
              difficulty: 2,
            },
          ]),
          provider: "gemini",
          model: "gemini-test",
        };
      }
      if (input.system === CATEGORY_PROMPTS["system-design"].system) {
        return {
          text: questionPayload([
            {
              requirement_ids: ["r2"],
              prompt: "Design a high-traffic collaboration feed.",
              answer_outline: "load, cache, consistency",
              difficulty: 3,
            },
          ]),
          provider: "gemini",
          model: "gemini-test",
        };
      }
      if (input.system === CATEGORY_PROMPTS["company-fit"].system) {
        return {
          text: questionPayload([
            {
              requirement_ids: [],
              prompt: "Why Acme's slow-ship culture?",
              answer_outline: "values alignment",
              difficulty: 1,
            },
          ]),
          provider: "gemini",
          model: "gemini-test",
        };
      }
      throw new Error(`unexpected system prompt: ${input.system.slice(0, 80)}`);
    });

    const questions = await generateQuestions(
      testClient(primary),
      {
        requirements: ACME_REQS,
        seniority: "senior",
        interviewProcess: ACME_PROCESS,
        companyBrief: ACME_BRIEF,
        valuesText: "We ship slowly and measure carefully.",
      },
      { cacheDir: false },
    );

    expect(primary.calls).toBe(4);
    expect(primary.inputs.map((i) => i.system)).toEqual([
      CATEGORY_PROMPTS.technical.system,
      CATEGORY_PROMPTS.behavioural.system,
      CATEGORY_PROMPTS["system-design"].system,
      CATEGORY_PROMPTS["company-fit"].system,
    ]);
    expect(primary.inputs.map((i) => i.user)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(CATEGORY_PROMPTS.technical.instruction),
        expect.stringContaining(CATEGORY_PROMPTS.behavioural.instruction),
        expect.stringContaining(CATEGORY_PROMPTS["system-design"].instruction),
        expect.stringContaining(CATEGORY_PROMPTS["company-fit"].instruction),
      ]),
    );

    // Distinct instructions across the four calls
    const instructions = primary.inputs.map((i) => {
      const match = Object.values(CATEGORY_PROMPTS).find((p) =>
        i.user.includes(p.instruction),
      );
      return match?.instruction;
    });
    expect(new Set(instructions).size).toBe(4);

    // Untrusted wrapping for requirements
    expect(primary.inputs[0]!.user).toContain(
      wrapUntrusted(
        "requirements",
        [
          "- id=r1 kind=technical priority=must: 5+ years of professional experience with React and TypeScript",
          "- id=r2 kind=technical priority=must: Strong system design skills for high-traffic web apps",
          "- id=r4 kind=domain priority=nice: Familiarity with GraphQL",
        ].join("\n"),
      ),
    );
    expect(primary.inputs[0]!.user).toContain("take-home");

    const categories = [...new Set(questions.map((q) => q.category))].sort();
    expect(categories).toEqual([
      "behavioural",
      "company-fit",
      "system-design",
      "technical",
    ]);
    expect(questions.every((q) => q.id.match(/^q\d+$/))).toBe(true);
    expect(questions.every((q) => q.meta?.origin === "generated")).toBe(true);
    expect(questions.some((q) => /take-home/i.test(q.prompt))).toBe(true);
  });

  it("quietco: skips system-design; category set differs from acme", async () => {
    const primary = fakeProvider("gemini", (input) => {
      if (input.system === CATEGORY_PROMPTS.technical.system) {
        return {
          text: questionPayload([
            {
              requirement_ids: ["r1"],
              prompt: "How would you model Postgres schemas for QuietCo?",
              answer_outline: "tables, indexes",
              difficulty: 2,
            },
          ]),
          provider: "gemini",
          model: "gemini-test",
        };
      }
      if (input.system === CATEGORY_PROMPTS.behavioural.system) {
        throw new Error("no behavioural reqs — should not call");
      }
      if (input.system === CATEGORY_PROMPTS["system-design"].system) {
        throw new Error("quietco must not call system-design");
      }
      if (input.system === CATEGORY_PROMPTS["company-fit"].system) {
        return {
          text: questionPayload([
            {
              requirement_ids: [],
              prompt: "What little we know about QuietCo — what would you ask?",
              answer_outline: "honest curiosity",
              difficulty: 1,
            },
          ]),
          provider: "gemini",
          model: "gemini-test",
        };
      }
      throw new Error(`unexpected system: ${input.system.slice(0, 60)}`);
    });

    const questions = await generateQuestions(
      testClient(primary),
      {
        requirements: QUIETCO_REQS,
        seniority: "mid",
        interviewProcess: QUIETCO_PROCESS,
        companyBrief: QUIETCO_BRIEF,
      },
      { cacheDir: false },
    );

    expect(primary.calls).toBe(2);
    expect(primary.inputs.map((i) => i.system)).toEqual([
      CATEGORY_PROMPTS.technical.system,
      CATEGORY_PROMPTS["company-fit"].system,
    ]);
    const categories = [...new Set(questions.map((q) => q.category))].sort();
    expect(categories).toEqual(["company-fit", "technical"]);
    expect(categories).not.toContain("system-design");
  });
});
