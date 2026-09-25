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
  FLASHCARD_PROMPT,
  assignFlashcardIds,
  coveredRequirementIds,
  ensureMustFlashcards,
  fallbackFlashcardFor,
  finalizeFlashcards,
  generateFlashcards,
} from "./generateFlashcards.js";

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

const REQS: Requirement[] = [
  {
    id: "r1",
    text: "5+ years of professional experience with React and TypeScript",
    kind: "technical",
    priority: "must",
  },
  {
    id: "r2",
    text: "Experience mentoring junior engineers",
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

const QUESTIONS: Question[] = [
  {
    id: "q1",
    requirement_ids: ["r1"],
    category: "technical",
    prompt: "Walk through a React + TypeScript feature you shipped.",
    answer_outline: "Hooks, typed props, testing",
    difficulty: 2,
    meta: { origin: "generated" },
  },
  {
    id: "q2",
    requirement_ids: ["r2"],
    category: "behavioural",
    prompt: "Tell me about mentoring a junior.",
    answer_outline: "S: onboardee T: ramp A: pairing R: shipped",
    difficulty: 2,
    meta: { origin: "generated" },
  },
];

function cardPayload(
  items: { front: string; back: string; requirement_ids: string[] }[],
): string {
  return JSON.stringify({ flashcards: items });
}

describe("finalizeFlashcards / assignFlashcardIds", () => {
  it("drops unknown requirement ids and empty fronts; sets origin generated", () => {
    const finalized = finalizeFlashcards(
      [
        {
          front: "React hooks cue",
          back: "useState / useEffect",
          requirement_ids: ["r1", "invented"],
        },
        {
          front: "  ",
          back: "orphan",
          requirement_ids: ["r1"],
        },
        {
          front: "no known ids",
          back: "x",
          requirement_ids: ["nope"],
        },
      ],
      new Set(["r1"]),
    );

    expect(finalized).toHaveLength(1);
    expect(finalized[0]!.requirement_ids).toEqual(["r1"]);
    expect(finalized[0]!.meta).toEqual({ origin: "generated" });
  });

  it("assigns f1.. ids in order", () => {
    const ids = assignFlashcardIds([
      {
        front: "a",
        back: "b",
        requirement_ids: ["r1"],
        meta: { origin: "generated" },
      },
      {
        front: "c",
        back: "d",
        requirement_ids: ["r2"],
        meta: { origin: "fallback" },
      },
    ]);
    expect(ids.map((c) => c.id)).toEqual(["f1", "f2"]);
  });
});

describe("ensureMustFlashcards", () => {
  it("adds deterministic fallback cards for uncovered must requirements", () => {
    const generated = finalizeFlashcards(
      [
        {
          front: "React cue",
          back: "TS + hooks",
          requirement_ids: ["r1"],
        },
      ],
      new Set(["r1", "r2", "r3"]),
    );

    const withMusts = ensureMustFlashcards(generated, REQS, QUESTIONS);
    const covered = coveredRequirementIds(withMusts);

    expect(covered.has("r1")).toBe(true);
    expect(covered.has("r2")).toBe(true);
    // nice-only gap is allowed
    expect(covered.has("r3")).toBe(false);

    const fallback = withMusts.find((c) => c.meta?.origin === "fallback");
    expect(fallback).toBeDefined();
    expect(fallback!.requirement_ids).toEqual(["r2"]);
    expect(fallback!.front).toContain("mentoring");
    expect(fallback!.back).toContain("pairing");
  });

  it("fallback uses requirement text when no related questions exist", () => {
    const card = fallbackFlashcardFor(REQS[0]!, []);
    expect(card.meta).toEqual({ origin: "fallback" });
    expect(card.requirement_ids).toEqual(["r1"]);
    expect(card.back).toContain(REQS[0]!.text);
  });
});

describe("generateFlashcards", () => {
  it("uses wrapUntrusted, distinct flashcard prompt, and assigns f ids", async () => {
    const primary = fakeProvider("gemini", (input) => {
      expect(input.system).toBe(FLASHCARD_PROMPT.system);
      expect(input.user).toContain(FLASHCARD_PROMPT.instruction);
      expect(input.user).toContain('<untrusted_document source="requirements">');
      expect(input.user).toContain('<untrusted_document source="questions">');
      expect(input.user).toContain("r1");
      expect(input.user).toContain("q1");
      return {
        text: cardPayload([
          {
            front: "React + TS years?",
            back: "Ship features with hooks and typed APIs",
            requirement_ids: ["r1"],
          },
          {
            front: "Mentoring example",
            back: "STAR mentoring story",
            requirement_ids: ["r2"],
          },
          {
            front: "GraphQL nice-to-have",
            back: "queries vs mutations",
            requirement_ids: ["r3"],
          },
          {
            front: "bogus",
            back: "x",
            requirement_ids: ["invented"],
          },
        ]),
        provider: "gemini",
        model: "gemini-test",
      };
    });

    const cards = await generateFlashcards(testClient(primary), {
      questions: QUESTIONS,
      requirements: REQS,
    });

    expect(primary.calls).toBe(1);
    expect(cards.map((c) => c.id)).toEqual(["f1", "f2", "f3"]);
    expect(cards.every((c) => c.meta?.origin === "generated")).toBe(true);
    expect(coveredRequirementIds(cards).has("r1")).toBe(true);
    expect(coveredRequirementIds(cards).has("r2")).toBe(true);
  });

  it("guarantees ≥1 card per must even when the model omits them", async () => {
    const primary = fakeProvider("gemini", () => ({
      text: cardPayload([
        {
          front: "Only nice GraphQL",
          back: "schema basics",
          requirement_ids: ["r3"],
        },
      ]),
      provider: "gemini",
      model: "gemini-test",
    }));

    const cards = await generateFlashcards(testClient(primary), {
      questions: QUESTIONS,
      requirements: REQS,
    });

    const mustIds = REQS.filter((r) => r.priority === "must").map((r) => r.id);
    const covered = coveredRequirementIds(cards);
    for (const id of mustIds) {
      expect(covered.has(id)).toBe(true);
    }

    const fallbacks = cards.filter((c) => c.meta?.origin === "fallback");
    expect(fallbacks.length).toBe(2);
    expect(fallbacks.map((c) => c.requirement_ids[0]).sort()).toEqual([
      "r1",
      "r2",
    ]);
    expect(cards[0]!.id).toBe("f1");
    expect(cards.at(-1)!.id).toMatch(/^f\d+$/);
  });

  it("covers musts via fallback when the model returns no usable cards", async () => {
    const primary = fakeProvider("gemini", () => ({
      text: cardPayload([]),
      provider: "gemini",
      model: "gemini-test",
    }));

    const cards = await generateFlashcards(testClient(primary), {
      questions: [],
      requirements: [
        {
          id: "r1",
          text: "Know TypeScript",
          kind: "technical",
          priority: "must",
        },
      ],
    });

    expect(primary.calls).toBe(1);
    expect(cards).toHaveLength(1);
    expect(cards[0]!).toMatchObject({
      id: "f1",
      requirement_ids: ["r1"],
      meta: { origin: "fallback" },
    });
  });

  it("skips LLM when there is nothing to send", async () => {
    const primary = fakeProvider("gemini", () => {
      throw new Error("should not call LLM");
    });

    const cards = await generateFlashcards(testClient(primary), {
      questions: [],
      requirements: [],
    });

    expect(primary.calls).toBe(0);
    expect(cards).toEqual([]);
  });
});
