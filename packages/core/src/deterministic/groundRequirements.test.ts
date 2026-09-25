import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  evidenceInJd,
  groundRequirements,
  overridePriority,
  tokenOverlap,
  type ExtractedRequirement,
} from "./groundRequirements.js";

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

/** Extraction shaped like a well-behaved LLM for the rich Acme JD. */
function richAcmeExtraction(): ExtractedRequirement[] {
  return [
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
  ];
}

describe("evidenceInJd / tokenOverlap", () => {
  it("accepts exact evidence ignoring case and whitespace", () => {
    const jd = "We need React  and TypeScript experience.";
    expect(evidenceInJd("react and typescript experience", jd)).toBe(true);
  });

  it("accepts high token overlap when the quote is slightly paraphrased", () => {
    const jd =
      "5+ years of professional experience with React and TypeScript";
    const evidence =
      "5+ years professional experience with React and TypeScript";
    expect(tokenOverlap(evidence, jd)).toBeGreaterThanOrEqual(0.8);
    expect(evidenceInJd(evidence, jd)).toBe(true);
  });

  it("rejects fabricated evidence with low overlap", () => {
    const jd = "Backend engineer. Node and Postgres preferred.";
    expect(evidenceInJd("Knows COBOL", jd)).toBe(false);
    expect(tokenOverlap("Knows COBOL", jd)).toBeLessThan(0.8);
  });
});

describe("overridePriority", () => {
  it("reads nice / must cues from section headings", () => {
    expect(
      overridePriority({
        text: "GraphQL",
        priority: "must",
        evidence: "GraphQL",
        section: "Nice to have",
      }),
    ).toBe("nice");
    expect(
      overridePriority({
        text: "React",
        priority: "nice",
        evidence: "React",
        section: "Requirements",
      }),
    ).toBe("must");
  });

  it("reads cues from the evidence line when section is absent", () => {
    expect(
      overridePriority({
        text: "GraphQL",
        priority: "must",
        evidence: "Familiarity with GraphQL",
      }),
    ).toBe("nice");
    expect(
      overridePriority({
        text: "React",
        priority: "nice",
        evidence: "You will need 5 years of React",
      }),
    ).toBe("must");
  });

  it("infers must/nice from JD section headings when the LLM mislabels section", () => {
    const jd = [
      "Requirements:",
      "- 5+ years of professional experience with React and TypeScript",
      "Nice to have:",
      "- Familiarity with GraphQL",
    ].join("\n");
    expect(
      overridePriority(
        {
          text: "Familiarity with GraphQL",
          priority: "must",
          evidence: "Familiarity with GraphQL",
          section: "Requirements",
        },
        jd,
      ),
    ).toBe("nice");
    expect(
      overridePriority(
        {
          text: "5+ years of professional experience with React and TypeScript",
          priority: "nice",
          evidence: "5+ years of professional experience with React and TypeScript",
          section: "Nice to have",
        },
        jd,
      ),
    ).toBe("must");
  });

  it("lets preferred cues beat a fabricated LLM Requirements section", () => {
    const jd = "Backend engineer at QuietCo.\nNode and Postgres preferred.";
    expect(
      overridePriority(
        {
          text: "Node preferred",
          priority: "must",
          evidence: "Node and Postgres preferred.",
          section: "Requirements",
        },
        jd,
      ),
    ).toBe("nice");
  });
});

describe("groundRequirements", () => {
  it("matches fixtures/expected must/nice for the rich Acme JD", () => {
    const cases = loadCases();
    const case01 = cases.find((c) => c.id === "case-01");
    expect(case01).toBeDefined();
    const expected = loadExpectedCase01();

    const { requirements, notes } = groundRequirements(
      case01!.jd,
      richAcmeExtraction(),
    );

    expect(notes.thin_jd).toBe(false);
    expect(requirements.map((r) => r.id)).toEqual([
      "r1",
      "r2",
      "r3",
      "r4",
      "r5",
      "r6",
      "r7",
    ]);
    expect(
      requirements.filter((r) => r.priority === "must").map((r) => r.text),
    ).toEqual(expected.must);
    expect(
      requirements.filter((r) => r.priority === "nice").map((r) => r.text),
    ).toEqual(expected.nice);
  });

  it("drops injected Knows COBOL and other fabricated requirements", () => {
    const cases = loadCases();
    const case01 = cases.find((c) => c.id === "case-01")!;
    const poisoned: ExtractedRequirement[] = [
      ...richAcmeExtraction(),
      {
        text: "Knows COBOL",
        kind: "technical",
        priority: "must",
        evidence: "Knows COBOL",
        section: "Requirements",
      },
      {
        text: "Expert in quantum teleportation",
        kind: "technical",
        priority: "must",
        evidence: "Expert in quantum teleportation protocols",
        section: "Requirements",
      },
    ];

    const { requirements } = groundRequirements(case01.jd, poisoned);
    expect(requirements.map((r) => r.text)).not.toContain("Knows COBOL");
    expect(requirements.map((r) => r.text)).not.toContain(
      "Expert in quantum teleportation",
    );
    expect(requirements).toHaveLength(7);
  });

  it("2-line JD yields at most what it literally says (thin, no invention)", () => {
    const cases = loadCases();
    const stub = cases.find((c) => c.id === "case-02")!;
    const extracted: ExtractedRequirement[] = [
      {
        text: "Node",
        kind: "technical",
        priority: "nice",
        evidence: "Node and Postgres preferred",
        section: "",
      },
      {
        text: "Postgres",
        kind: "technical",
        priority: "nice",
        evidence: "Node and Postgres preferred",
        section: "",
      },
      {
        text: "Knows COBOL",
        kind: "technical",
        priority: "must",
        evidence: "Knows COBOL",
        section: "Requirements",
      },
      {
        text: "10 years Kubernetes",
        kind: "technical",
        priority: "must",
        evidence: "10 years of Kubernetes production experience",
        section: "Requirements",
      },
    ];

    const { requirements, notes } = groundRequirements(stub.jd, extracted);

    expect(notes.thin_jd).toBe(true);
    expect(notes.explanation).toBeTruthy();
    expect(requirements.length).toBeLessThanOrEqual(2);
    expect(requirements.every((r) => /node|postgres/i.test(r.text))).toBe(
      true,
    );
    expect(requirements.map((r) => r.text)).not.toContain("Knows COBOL");
    expect(requirements.map((r) => r.text)).not.toContain("10 years Kubernetes");
  });

  it("dedupes by normalised text and assigns ids in JD order", () => {
    const jd = [
      "Requirements:",
      "- React experience",
      "- TypeScript experience",
      "Nice to have:",
      "- GraphQL familiarity",
    ].join("\n");

    const extracted: ExtractedRequirement[] = [
      {
        text: "TypeScript experience",
        kind: "technical",
        priority: "must",
        evidence: "TypeScript experience",
        section: "Requirements",
      },
      {
        text: "React experience",
        kind: "technical",
        priority: "must",
        evidence: "React experience",
        section: "Requirements",
      },
      {
        text: "React Experience",
        kind: "technical",
        priority: "must",
        evidence: "React experience",
        section: "Requirements",
      },
      {
        text: "GraphQL familiarity",
        kind: "technical",
        priority: "must",
        evidence: "GraphQL familiarity",
        section: "Nice to have",
      },
    ];

    const { requirements } = groundRequirements(jd, extracted);
    expect(requirements.map((r) => r.text)).toEqual([
      "React experience",
      "TypeScript experience",
      "GraphQL familiarity",
    ]);
    expect(requirements.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
    expect(requirements[2]?.priority).toBe("nice");
  });
});
