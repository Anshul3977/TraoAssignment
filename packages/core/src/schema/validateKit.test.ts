import { describe, expect, it } from "vitest";
import { BatchOutputSchema, type Kit, validateKit } from "./index.js";

function validKit(overrides: Record<string, unknown> = {}): Kit {
  const base: Kit = {
    source: {
      company: "Acme",
      company_url: "http://localhost:8099/acme/",
      role: "Senior Engineer",
      location: "Remote",
      jd_chars: 120,
      researched_at: "2026-09-25T00:00:00Z",
      pages_used: ["http://localhost:8099/acme/"],
    },
    company_brief: {
      summary: "Acme builds widgets.",
      what_they_do: "Widget platform",
      sources: ["http://localhost:8099/acme/"],
    },
    role: {
      title: "Senior Engineer",
      seniority: "senior",
      responsibilities: ["Ship features"],
      requirements: [
        {
          id: "r1",
          text: "5+ years with React",
          kind: "technical",
          priority: "must",
        },
        {
          id: "r2",
          text: "Mentors juniors",
          kind: "behavioural",
          priority: "nice",
        },
      ],
    },
    questions: [
      {
        id: "q1",
        requirement_ids: ["r1"],
        category: "technical",
        prompt: "Explain React reconciliation.",
        answer_outline: "Virtual DOM diffing…",
        difficulty: 2,
      },
    ],
    flashcards: [
      {
        id: "f1",
        front: "What is reconciliation?",
        back: "Diffing virtual trees",
        requirement_ids: ["r1"],
      },
    ],
    schedule: {
      days_available: 2,
      days: [
        { day: 1, focus: "React", question_ids: ["q1"], minutes: 60 },
        { day: 2, focus: "Review", question_ids: ["q1"], minutes: 30 },
      ],
    },
    coverage: {
      uncovered_requirement_ids: ["r2"],
      passes: 1,
    },
  };
  return { ...base, ...overrides } as Kit;
}

function expectFailPath(input: unknown, pathSubstring: string) {
  const result = validateKit(input);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  const paths = result.issues.map((i) => i.path);
  expect(
    paths.some((p) => p.includes(pathSubstring)),
    `expected an issue path containing "${pathSubstring}", got: ${paths.join(", ")}`,
  ).toBe(true);
  for (const issue of result.issues) {
    expect(issue.path.length).toBeGreaterThan(0);
    expect(issue.message.length).toBeGreaterThan(0);
  }
}

describe("validateKit", () => {
  it("accepts a valid Appendix A sample (with optional extensions)", () => {
    const result = validateKit(
      validKit({
        research_log: { skipped: [{ url: "x", reason: "timeout" }] },
        notes: { thin_jd: false },
        questions: [
          {
            id: "q1",
            requirement_ids: ["r1"],
            category: "technical",
            prompt: "Explain React reconciliation.",
            answer_outline: "Virtual DOM diffing…",
            difficulty: 2,
            meta: { origin: "generated", edited: false },
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.kit.questions[0]?.id).toBe("q1");
      expect(result.kit.research_log).toBeDefined();
      expect(result.kit.notes).toEqual({ thin_jd: false });
    }
  });

  it("rejects duplicate requirement ids with a readable path", () => {
    const kit = validKit();
    kit.role.requirements.push({
      id: "r1",
      text: "dup",
      kind: "technical",
      priority: "must",
    });
    expectFailPath(kit, "role.requirements[2].id");
  });

  it("rejects duplicate question ids with a readable path", () => {
    const kit = validKit();
    kit.questions.push({
      id: "q1",
      requirement_ids: ["r1"],
      category: "technical",
      prompt: "dup",
      answer_outline: "",
      difficulty: 1,
    });
    expectFailPath(kit, "questions[1].id");
  });

  it("rejects unknown question requirement_ids with a readable path", () => {
    const kit = validKit();
    kit.questions[0]!.requirement_ids = ["r1", "r999"];
    expectFailPath(kit, "questions[0].requirement_ids[1]");
  });

  it("rejects unknown flashcard requirement_ids with a readable path", () => {
    const kit = validKit();
    kit.flashcards[0]!.requirement_ids = ["missing"];
    expectFailPath(kit, "flashcards[0].requirement_ids[0]");
  });

  it("rejects unknown schedule question_ids with a readable path", () => {
    const kit = validKit();
    kit.schedule.days[0]!.question_ids = ["q-missing"];
    expectFailPath(kit, "schedule.days[0].question_ids[0]");
  });

  it("rejects days.length !== days_available with a readable path", () => {
    const kit = validKit();
    kit.schedule.days_available = 5;
    expectFailPath(kit, "schedule.days");
  });

  it("rejects non-integer minutes with a readable path", () => {
    const kit = validKit();
    kit.schedule.days[0]!.minutes = 30.5;
    expectFailPath(kit, "minutes");
  });

  it("rejects negative minutes with a readable path", () => {
    const kit = validKit();
    kit.schedule.days[0]!.minutes = -1;
    expectFailPath(kit, "minutes");
  });

  it("rejects difficulty outside {1,2,3} with a readable path", () => {
    const kit = validKit();
    (kit.questions[0] as { difficulty: number }).difficulty = 4;
    expectFailPath(kit, "difficulty");
  });
});

describe("BatchOutputSchema", () => {
  it("parses Appendix B output", () => {
    const parsed = BatchOutputSchema.safeParse({
      version: "1.0",
      generated_at: "2026-09-01T09:12:44Z",
      kits: [
        { id: "case-01", status: "ok", kit: validKit(), error: null },
        {
          id: "case-04",
          status: "failed",
          kit: null,
          error: {
            code: "COMPANY_UNREACHABLE",
            message: "Company site unreachable after 3 retries.",
          },
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});
