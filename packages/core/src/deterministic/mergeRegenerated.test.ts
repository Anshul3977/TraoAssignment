import { describe, expect, it } from "vitest";
import type { Kit, Question } from "../schema/kit.js";
import { allocateSchedule } from "./allocateSchedule.js";
import {
  categoryForRequirementKind,
  isProtectedItem,
  mergeRegenerated,
  normalisePrompt,
} from "./mergeRegenerated.js";

function baseKit(overrides: Partial<Kit> = {}): Kit {
  const kit: Kit = {
    source: {
      company: "Acme",
      company_url: "http://localhost:8099/acme/",
      role: "Senior Engineer",
      location: "Remote",
      jd_chars: 200,
      researched_at: "2026-09-25T00:00:00Z",
      pages_used: ["http://localhost:8099/acme/"],
    },
    company_brief: {
      summary: "Acme builds widgets.",
      what_they_do: "Widget platform",
      sources: ["http://localhost:8099/acme/"],
      meta: { edited: false },
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
          priority: "must",
        },
        {
          id: "r3",
          text: "GraphQL familiarity",
          kind: "technical",
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
        answer_outline: "Virtual DOM…",
        difficulty: 2,
        meta: { origin: "generated", edited: false, pinned: false },
      },
      {
        id: "q2",
        requirement_ids: ["r3"],
        category: "technical",
        prompt: "When would you choose GraphQL?",
        answer_outline: "Overfetch…",
        difficulty: 1,
        meta: { origin: "generated", edited: false, pinned: false },
      },
      {
        id: "q3",
        requirement_ids: ["r2"],
        category: "behavioural",
        prompt: "Tell me about mentoring a junior.",
        answer_outline: "STAR…",
        difficulty: 2,
        meta: { origin: "generated", edited: false, pinned: false },
      },
    ],
    flashcards: [
      {
        id: "f1",
        front: "Reconciliation?",
        back: "Diffing trees",
        requirement_ids: ["r1"],
      },
    ],
    schedule: {
      days_available: 2,
      days: [
        { day: 1, focus: "React", question_ids: ["q1", "q2"], minutes: 40 },
        { day: 2, focus: "Behavioural", question_ids: ["q3"], minutes: 20 },
      ],
    },
    coverage: {
      uncovered_requirement_ids: [],
      passes: 1,
    },
    meta: {
      next_ids: { question: 4, flashcard: 2 },
      dismissed: [],
      version: 1,
    },
  };
  return { ...kit, ...overrides };
}

function q(
  partial: Partial<Question> & Pick<Question, "id" | "prompt" | "category">,
): Question {
  return {
    requirement_ids: partial.requirement_ids ?? ["r1"],
    answer_outline: partial.answer_outline ?? "outline",
    difficulty: partial.difficulty ?? 2,
    meta: partial.meta ?? { origin: "generated", edited: false, pinned: false },
    ...partial,
  };
}

describe("helpers", () => {
  it("normalisePrompt collapses case and whitespace", () => {
    expect(normalisePrompt("  Hello   World  ")).toBe("hello world");
  });

  it("isProtectedItem covers user / edited / pinned", () => {
    expect(isProtectedItem({ origin: "user" })).toBe(true);
    expect(isProtectedItem({ origin: "generated", edited: true })).toBe(true);
    expect(isProtectedItem({ origin: "generated", pinned: true })).toBe(true);
    expect(isProtectedItem({ origin: "generated", edited: false })).toBe(false);
    expect(isProtectedItem({ origin: "fallback" })).toBe(false);
  });

  it("categoryForRequirementKind maps technical/domain/behavioural", () => {
    expect(categoryForRequirementKind("technical")).toBe("technical");
    expect(categoryForRequirementKind("domain")).toBe("technical");
    expect(categoryForRequirementKind("behavioural")).toBe("behavioural");
  });
});

describe("mergeRegenerated — questions", () => {
  it("keeps edited, pinned, and user-added questions in place", () => {
    const kit = baseKit({
      questions: [
        q({
          id: "q1",
          category: "technical",
          prompt: "Edited React Q",
          requirement_ids: ["r1"],
          meta: { origin: "generated", edited: true, pinned: false },
        }),
        q({
          id: "q2",
          category: "technical",
          prompt: "Pinned GraphQL",
          requirement_ids: ["r3"],
          meta: { origin: "generated", edited: false, pinned: true },
        }),
        q({
          id: "q9",
          category: "technical",
          prompt: "My own question",
          requirement_ids: ["r1"],
          meta: { origin: "user", edited: false, pinned: false },
        }),
        q({
          id: "q3",
          category: "behavioural",
          prompt: "Mentoring",
          requirement_ids: ["r2"],
        }),
      ],
    });

    const { kit: out, questionsChanged } = mergeRegenerated({
      kit,
      section: "questions",
      category: "technical",
      questions: [
        q({
          id: "TEMP",
          category: "technical",
          prompt: "Brand new generated React Q",
          requirement_ids: ["r1"],
        }),
      ],
    });

    expect(questionsChanged).toBe(true);
    const tech = out.questions.filter((x) => x.category === "technical");
    expect(tech.map((x) => x.prompt)).toEqual([
      "Edited React Q",
      "Pinned GraphQL",
      "My own question",
      "Brand new generated React Q",
    ]);
    expect(tech[0]!.id).toBe("q1");
    expect(tech[1]!.id).toBe("q2");
    expect(tech[2]!.id).toBe("q9");
    // Counter = max(meta.next_ids.question, maxExisting+1) → q10 beats stale next_ids:4
    expect(tech[3]!.id).toBe("q10");
    expect(out.questions.find((x) => x.id === "q3")?.prompt).toBe("Mentoring");
  });

  it("leaves other categories untouched", () => {
    const kit = baseKit();
    const behaviouralBefore = kit.questions.filter(
      (x) => x.category === "behavioural",
    );

    const { kit: out } = mergeRegenerated({
      kit,
      section: "questions",
      category: "technical",
      questions: [
        q({
          id: "x",
          category: "technical",
          prompt: "Fresh technical",
          requirement_ids: ["r1", "r3"],
        }),
      ],
    });

    expect(out.questions.filter((x) => x.category === "behavioural")).toEqual(
      behaviouralBefore,
    );
  });

  it("does not resurrect dismissed prompts", () => {
    const kit = baseKit({
      meta: {
        next_ids: { question: 10 },
        dismissed: [normalisePrompt("When would you choose GraphQL?")],
      },
    });

    const { kit: out } = mergeRegenerated({
      kit,
      section: "questions",
      category: "technical",
      questions: [
        q({
          id: "x",
          category: "technical",
          prompt: "When would you choose GraphQL?",
          requirement_ids: ["r3"],
        }),
        q({
          id: "y",
          category: "technical",
          prompt: "Describe React hooks rules",
          requirement_ids: ["r1"],
        }),
      ],
    });

    const prompts = out.questions
      .filter((x) => x.category === "technical")
      .map((x) => x.prompt);
    expect(prompts).not.toContain("When would you choose GraphQL?");
    expect(prompts).toContain("Describe React hooks rules");
  });

  it("never reuses ids — advances meta.next_ids", () => {
    const kit = baseKit();
    const { kit: out } = mergeRegenerated({
      kit,
      section: "questions",
      category: "technical",
      questions: [
        q({
          id: "q1", // would collide if reused
          category: "technical",
          prompt: "New A",
          requirement_ids: ["r1"],
        }),
        q({
          id: "q2",
          category: "technical",
          prompt: "New B",
          requirement_ids: ["r3"],
        }),
      ],
    });

    const ids = out.questions.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("q3"); // behavioural kept
    expect(ids).toContain("q4");
    expect(ids).toContain("q5");
    expect(ids).not.toContain("q1");
    expect(ids).not.toContain("q2");
    expect((out.meta as { next_ids: { question: number } }).next_ids.question).toBeGreaterThan(
      5,
    );
  });

  it("adds fallback for must-gaps in the regenerated category", () => {
    const kit = baseKit({
      questions: [
        q({
          id: "q3",
          category: "behavioural",
          prompt: "Mentoring",
          requirement_ids: ["r2"],
        }),
      ],
      meta: { next_ids: { question: 10 }, dismissed: [] },
    });

    // Regen technical with empty candidates → must r1 needs fallback; nice r3 may remain
    const { kit: out } = mergeRegenerated({
      kit,
      section: "questions",
      category: "technical",
      questions: [],
    });

    const tech = out.questions.filter((x) => x.category === "technical");
    expect(tech.length).toBe(1);
    expect(tech[0]!.meta).toMatchObject({ origin: "fallback" });
    expect(tech[0]!.requirement_ids).toEqual(["r1"]);
    expect(out.coverage.uncovered_requirement_ids).toEqual(["r3"]);
  });

  it("keeps schedule question_ids valid when questions change (realloc hook)", () => {
    const kit = baseKit();
    const { kit: out, questionsChanged } = mergeRegenerated({
      kit,
      section: "questions",
      category: "technical",
      questions: [
        q({
          id: "x",
          category: "technical",
          prompt: "New React deep dive",
          requirement_ids: ["r1"],
          difficulty: 3,
        }),
      ],
      reallocateSchedule: (k) =>
        allocateSchedule(
          k.role.requirements,
          k.questions,
          k.schedule.days_available,
        ).schedule,
    });

    expect(questionsChanged).toBe(true);
    const valid = new Set(out.questions.map((x) => x.id));
    for (const day of out.schedule.days) {
      for (const id of day.question_ids) {
        expect(valid.has(id)).toBe(true);
      }
    }
    expect(out.schedule.days_available).toBe(2);
    expect(out.schedule.days).toHaveLength(2);
  });

  it("prunes stale schedule refs when no realloc hook is provided", () => {
    const kit = baseKit();
    const { kit: out } = mergeRegenerated({
      kit,
      section: "questions",
      category: "technical",
      questions: [
        q({
          id: "x",
          category: "technical",
          prompt: "Only new tech Q",
          requirement_ids: ["r1", "r3"],
        }),
      ],
    });

    const valid = new Set(out.questions.map((x) => x.id));
    for (const day of out.schedule.days) {
      for (const id of day.question_ids) {
        expect(valid.has(id)).toBe(true);
      }
    }
    // Old q1/q2 removed from schedule; behavioural q3 may remain on day 2
    expect(
      out.schedule.days.flatMap((d) => d.question_ids).every((id) => valid.has(id)),
    ).toBe(true);
  });

  it("throws when questions section omits category", () => {
    expect(() =>
      mergeRegenerated({
        kit: baseKit(),
        section: "questions",
        questions: [],
      }),
    ).toThrow(/category/i);
  });
});

describe("mergeRegenerated — brief", () => {
  it("skips brief when edited unless force", () => {
    const kit = baseKit({
      company_brief: {
        summary: "User-edited brief",
        what_they_do: "Custom",
        sources: ["http://localhost:8099/acme/"],
        meta: { edited: true },
      },
    });

    const skipped = mergeRegenerated({
      kit,
      section: "brief",
      brief: {
        summary: "LLM rewrite",
        what_they_do: "New",
        sources: ["http://localhost:8099/acme/about"],
      },
    });
    expect(skipped.briefSkipped).toBe(true);
    expect(skipped.kit.company_brief.summary).toBe("User-edited brief");

    const forced = mergeRegenerated({
      kit,
      section: "brief",
      force: true,
      brief: {
        summary: "LLM rewrite",
        what_they_do: "New",
        sources: ["http://localhost:8099/acme/about"],
      },
    });
    expect(forced.briefSkipped).toBe(false);
    expect(forced.kit.company_brief.summary).toBe("LLM rewrite");
  });

  it("replaces unedited brief", () => {
    const kit = baseKit();
    const { kit: out, briefSkipped } = mergeRegenerated({
      kit,
      section: "brief",
      brief: {
        summary: "Fresh brief",
        what_they_do: "Widgets v2",
        sources: ["http://localhost:8099/acme/"],
      },
    });
    expect(briefSkipped).toBe(false);
    expect(out.company_brief.summary).toBe("Fresh brief");
    expect(out.company_brief.meta).toMatchObject({ edited: false });
  });
});

describe("mergeRegenerated — schedule", () => {
  it("replaces schedule section without touching questions", () => {
    const kit = baseKit();
    const questionsBefore = kit.questions;
    const { kit: out, questionsChanged } = mergeRegenerated({
      kit,
      section: "schedule",
      schedule: {
        days_available: 1,
        days: [
          { day: 1, focus: "Mock interview + weak spots", question_ids: ["q1"], minutes: 30 },
        ],
      },
    });
    expect(questionsChanged).toBe(false);
    expect(out.questions).toEqual(questionsBefore);
    expect(out.schedule.days_available).toBe(1);
    expect(out.schedule.days[0]!.focus).toBe("Mock interview + weak spots");
  });

  it("uses reallocateSchedule hook when no schedule payload", () => {
    const kit = baseKit();
    const { kit: out } = mergeRegenerated({
      kit,
      section: "schedule",
      reallocateSchedule: (k) =>
        allocateSchedule(
          k.role.requirements,
          k.questions,
          k.schedule.days_available,
        ).schedule,
    });
    expect(out.schedule.days).toHaveLength(2);
    const valid = new Set(out.questions.map((x) => x.id));
    for (const day of out.schedule.days) {
      for (const id of day.question_ids) {
        expect(valid.has(id)).toBe(true);
      }
    }
  });
});
