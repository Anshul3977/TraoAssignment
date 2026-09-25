import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

function loadCases(): Array<{ id: string; jd: string }> {
  return JSON.parse(
    readFileSync(join(repoRoot, "fixtures/cases.json"), "utf8"),
  ) as Array<{ id: string; jd: string }>;
}

function loadExpectedCase01(): { must: string[]; nice: string[] } {
  return JSON.parse(
    readFileSync(
      join(repoRoot, "fixtures/expected/case-01-requirements.json"),
      "utf8",
    ),
  ) as { must: string[]; nice: string[] };
}

type ExtractedReq = {
  text: string;
  kind: "technical" | "behavioural" | "domain";
  priority: "must" | "nice";
  evidence: string;
  section?: string;
};

/**
 * Test double for T09a's groundRequirements (absent on lane/llm until merge).
 * Substring evidence check + section priority cues + r1..rn — enough to assert
 * fixture expectations without vendoring the deterministic lane.
 */
function mockGroundRequirements(
  jd: string,
  extracted: ExtractedReq[],
): {
  requirements: Requirement[];
  notes: { thin_jd: boolean; explanation?: string };
} {
  const j = jd.toLowerCase().replace(/\s+/g, " ");
  const kept: Array<ExtractedReq & { priority: "must" | "nice" }> = [];
  for (const item of extracted) {
    const e = item.evidence.toLowerCase().replace(/\s+/g, " ").trim();
    if (!e || !j.includes(e)) continue;
    const section = (item.section ?? "").toLowerCase();
    let priority = item.priority;
    if (/nice to have|bonus|preferred|a plus|ideally|familiarity with/.test(section)) {
      priority = "nice";
    } else if (/requirements|required|must|minimum|you have|you will need/.test(section)) {
      priority = "must";
    } else if (/familiarity with|nice to have|bonus|preferred/.test(e)) {
      priority = "nice";
    }
    kept.push({ ...item, priority });
  }
  const seen = new Set<string>();
  const requirements: Requirement[] = [];
  for (const item of kept) {
    const key = item.text.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    requirements.push({
      id: `r${requirements.length + 1}`,
      text: item.text,
      kind: item.kind,
      priority: item.priority,
    });
  }
  const thin = jd.trim().length < 80 || requirements.length < 3;
  return {
    requirements,
    notes: thin
      ? {
          thin_jd: true,
          explanation: `Only ${requirements.length} grounded requirement(s) found.`,
        }
      : { thin_jd: false },
  };
}

const groundRequirementsMock = vi.fn(mockGroundRequirements);

vi.mock("../deterministic/groundRequirements.js", () => ({
  groundRequirements: (...args: Parameters<typeof mockGroundRequirements>) =>
    groundRequirementsMock(...args),
}));

// Import after mock so the step binds to the mock module.
const { extractRequirements } = await import("./extractRequirements.js");

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

/** Fixture-like JSON a well-behaved model returns for the rich Acme JD. */
function richAcmeLlmJson() {
  return {
    title: "Senior Software Engineer",
    seniority: "senior",
    location: "",
    company: "Acme",
    responsibilities: [
      "Own the React design system used across product surfaces",
      "Mentor junior engineers through code review and pairing",
      "Partner with product on roadmap trade-offs",
    ],
    requirements: [
      {
        text: "5+ years of professional experience with React and TypeScript",
        kind: "technical",
        priority: "must",
        evidence: "5+ years of professional experience with React and TypeScript",
        section: "Requirements",
      },
      {
        text: "Strong system design skills for high-traffic web apps",
        kind: "technical",
        priority: "must",
        evidence: "Strong system design skills for high-traffic web apps",
        section: "Requirements",
      },
      {
        text: "Experience mentoring junior engineers",
        kind: "behavioural",
        priority: "must",
        evidence: "Experience mentoring junior engineers",
        section: "Requirements",
      },
      {
        text: "Excellent written communication",
        kind: "behavioural",
        priority: "must",
        evidence: "Excellent written communication",
        section: "Requirements",
      },
      {
        text: "Familiarity with GraphQL",
        kind: "technical",
        priority: "nice",
        evidence: "Familiarity with GraphQL",
        section: "Nice to have",
      },
      {
        text: "Prior experience at a B2B SaaS company",
        kind: "domain",
        priority: "nice",
        evidence: "Prior experience at a B2B SaaS company",
        section: "Nice to have",
      },
      {
        text: "Contributions to open-source React libraries",
        kind: "technical",
        priority: "nice",
        evidence: "Contributions to open-source React libraries",
        section: "Nice to have",
      },
    ],
  };
}

describe("extractRequirements", () => {
  beforeEach(() => {
    groundRequirementsMock.mockClear();
    groundRequirementsMock.mockImplementation(mockGroundRequirements);
  });

  it("sends the JD only via wrapUntrusted('jd', jd)", async () => {
    const cases = loadCases();
    const case01 = cases.find((c) => c.id === "case-01")!;
    const primary = fakeProvider("gemini", () => ({
      text: JSON.stringify(richAcmeLlmJson()),
      provider: "gemini",
      model: "gemini-test",
    }));

    await extractRequirements(testClient(primary), case01.jd, {
      cacheDir: false,
    });

    expect(primary.calls).toBe(1);
    const user = primary.lastInput!.user;
    const wrapped = wrapUntrusted("jd", case01.jd);
    expect(user).toContain(wrapped);
    expect(user.startsWith(wrapped) || user.includes(wrapped)).toBe(true);
    // Raw JD must not appear as a free-floating instruction — only inside the wrapper.
    const withoutWrapper = user.replace(wrapped, "");
    expect(withoutWrapper).not.toContain(case01.jd);
    expect(user).toMatch(/<untrusted_document source="jd">/);
  });

  it("grounds fixture-like LLM JSON to T09a expected must/nice", async () => {
    const cases = loadCases();
    const case01 = cases.find((c) => c.id === "case-01")!;
    const expected = loadExpectedCase01();
    const primary = fakeProvider("gemini", () => ({
      text: JSON.stringify(richAcmeLlmJson()),
      provider: "gemini",
      model: "gemini-test",
    }));

    const result = await extractRequirements(testClient(primary), case01.jd, {
      cacheDir: false,
    });

    expect(groundRequirementsMock).toHaveBeenCalledTimes(1);
    expect(groundRequirementsMock.mock.calls[0]?.[0]).toBe(case01.jd);
    expect(result.notes.thin_jd).toBe(false);
    expect(result.requirements.map((r) => r.id)).toEqual([
      "r1",
      "r2",
      "r3",
      "r4",
      "r5",
      "r6",
      "r7",
    ]);
    expect(
      result.requirements.filter((r) => r.priority === "must").map((r) => r.text),
    ).toEqual(expected.must);
    expect(
      result.requirements.filter((r) => r.priority === "nice").map((r) => r.text),
    ).toEqual(expected.nice);
    expect(result.title).toBe("Senior Software Engineer");
    expect(result.company).toBe("Acme");
  });

  it("drops ungrounded injections when the model returns them", async () => {
    const cases = loadCases();
    const case01 = cases.find((c) => c.id === "case-01")!;
    const poisoned = {
      ...richAcmeLlmJson(),
      requirements: [
        ...richAcmeLlmJson().requirements,
        {
          text: "Knows COBOL",
          kind: "technical" as const,
          priority: "must" as const,
          evidence: "Knows COBOL",
          section: "Requirements",
        },
      ],
    };
    const primary = fakeProvider("gemini", () => ({
      text: JSON.stringify(poisoned),
      provider: "gemini",
      model: "gemini-test",
    }));

    const result = await extractRequirements(testClient(primary), case01.jd, {
      cacheDir: false,
    });

    expect(result.requirements.map((r) => r.text)).not.toContain("Knows COBOL");
    expect(result.requirements).toHaveLength(7);
  });
});
