import { describe, expect, it } from "vitest";
import type { KitDocument, KitQuestion } from "./api";
import {
  SAVE_DEBOUNCE_MS,
  buildBriefRoleOps,
  buildPendingTextOps,
  buildQuestionTextOps,
  categoryTabLabel,
  coverageIndicator,
  draftsFromKit,
  isNetworkError,
  isProtectedQuestion,
  itemBadges,
  moveQuestionCategory,
  questionsKeptOnRegen,
  questionsReplacedOnRegen,
  reorderQuestionsInCategory,
  saveStatusLabel,
  setQuestionPinned,
} from "./kit-builder";

function sampleQuestions(): KitQuestion[] {
  return [
    {
      id: "q1",
      requirement_ids: ["r1"],
      category: "technical",
      prompt: "Explain React hooks",
      answer_outline: "useState, useEffect",
      difficulty: 2,
      meta: { origin: "generated", edited: false, pinned: false },
    },
    {
      id: "q2",
      requirement_ids: ["r1"],
      category: "technical",
      prompt: "Edited prompt",
      answer_outline: "outline",
      difficulty: 2,
      meta: { origin: "generated", edited: true, pinned: false },
    },
    {
      id: "q3",
      requirement_ids: ["r1"],
      category: "technical",
      prompt: "Pinned prompt",
      answer_outline: "outline",
      difficulty: 1,
      meta: { origin: "generated", edited: false, pinned: true },
    },
    {
      id: "q4",
      requirement_ids: ["r2"],
      category: "behavioural",
      prompt: "Tell me about mentoring",
      answer_outline: "STAR",
      difficulty: 2,
      meta: { origin: "user", edited: false, pinned: false },
    },
  ];
}

function sampleKit(overrides: Partial<KitDocument> = {}): KitDocument {
  const base: KitDocument = {
    source: {
      company: "Acme",
      company_url: "https://acme.example",
      role: "Engineer",
      location: "Remote",
      jd_chars: 100,
      researched_at: "2026-09-25T00:00:00Z",
      pages_used: ["https://acme.example"],
    },
    company_brief: {
      summary: "Acme builds widgets.",
      what_they_do: "Widget platform",
      sources: ["https://acme.example"],
      meta: { origin: "generated", edited: false },
    },
    role: {
      title: "Engineer",
      seniority: "senior",
      responsibilities: ["Ship"],
      requirements: [
        {
          id: "r1",
          text: "Know React",
          kind: "technical",
          priority: "must",
          meta: { origin: "generated" },
        },
        {
          id: "r2",
          text: "Mentors juniors",
          kind: "behavioural",
          priority: "nice",
          meta: { origin: "user", edited: true },
        },
      ],
    },
    questions: sampleQuestions(),
    flashcards: [],
    schedule: { days_available: 1, days: [] },
    coverage: {
      uncovered_requirement_ids: ["r2"],
      passes: 1,
    },
  };
  return { ...base, ...overrides };
}

describe("saveStatusLabel", () => {
  it("maps Saved / Saving… / Offline", () => {
    expect(saveStatusLabel("saved")).toBe("Saved");
    expect(saveStatusLabel("saving")).toBe("Saving…");
    expect(saveStatusLabel("offline")).toBe("Offline");
  });
});

describe("SAVE_DEBOUNCE_MS", () => {
  it("is 600 ms per T23a", () => {
    expect(SAVE_DEBOUNCE_MS).toBe(600);
  });
});

describe("itemBadges", () => {
  it("shows Edited, origin, and Pinned badges", () => {
    expect(itemBadges({ edited: true, origin: "generated" })).toEqual([
      { key: "edited", label: "Edited" },
      { key: "ai", label: "AI" },
    ]);
    expect(itemBadges({ origin: "user" })).toEqual([
      { key: "yours", label: "Yours" },
    ]);
    expect(
      itemBadges({ origin: "generated", pinned: true, edited: false }),
    ).toEqual([
      { key: "ai", label: "AI" },
      { key: "pinned", label: "Pinned" },
    ]);
  });
});

describe("isProtectedQuestion / regen keep lists", () => {
  it("protects user, edited, and pinned", () => {
    expect(isProtectedQuestion({ origin: "user" })).toBe(true);
    expect(isProtectedQuestion({ edited: true })).toBe(true);
    expect(isProtectedQuestion({ pinned: true })).toBe(true);
    expect(
      isProtectedQuestion({ origin: "generated", edited: false, pinned: false }),
    ).toBe(false);
  });

  it("lists kept vs replaced for a category (regen preserves edited/pinned/yours)", () => {
    const qs = sampleQuestions();
    const kept = questionsKeptOnRegen(qs, "technical");
    expect(kept.map((q) => q.id).sort()).toEqual(["q2", "q3"]);
    const replaced = questionsReplacedOnRegen(qs, "technical");
    expect(replaced.map((q) => q.id)).toEqual(["q1"]);
    // behavioural user question is kept in its own category
    expect(questionsKeptOnRegen(qs, "behavioural").map((q) => q.id)).toEqual([
      "q4",
    ]);
  });
});

describe("categoryTabLabel", () => {
  it("uses British spelling for Behavioural", () => {
    expect(categoryTabLabel("behavioural")).toBe("Behavioural");
    expect(categoryTabLabel("system-design")).toBe("System design");
  });
});

describe("coverageIndicator", () => {
  it("marks uncovered ids", () => {
    expect(coverageIndicator("r1", ["r2"])).toEqual({
      covered: true,
      label: "Covered",
    });
    expect(coverageIndicator("r2", ["r2"])).toEqual({
      covered: false,
      label: "Uncovered",
    });
  });
});

describe("buildBriefRoleOps", () => {
  it("emits brief + requirement update ops for changed text", () => {
    const saved = sampleKit();
    const { brief, requirements } = draftsFromKit(saved);
    const ops = buildBriefRoleOps(
      saved,
      { ...brief, summary: "Acme builds better widgets." },
      requirements.map((r) =>
        r.id === "r1" ? { ...r, text: "Know React deeply" } : r,
      ),
    );
    expect(ops).toEqual([
      {
        op: "update",
        target: "brief",
        set: { summary: "Acme builds better widgets." },
      },
      {
        op: "update",
        target: "requirement",
        id: "r1",
        set: { text: "Know React deeply" },
      },
    ]);
  });

  it("returns empty when drafts match saved", () => {
    const saved = sampleKit();
    const drafts = draftsFromKit(saved);
    expect(buildBriefRoleOps(saved, drafts.brief, drafts.requirements)).toEqual(
      [],
    );
  });

  it("skips empty strings so API min-length is respected", () => {
    const saved = sampleKit();
    const drafts = draftsFromKit(saved);
    const ops = buildBriefRoleOps(
      saved,
      { summary: "   ", what_they_do: drafts.brief.what_they_do },
      drafts.requirements.map((r) =>
        r.id === "r1" ? { ...r, text: "" } : r,
      ),
    );
    expect(ops).toEqual([]);
  });

  it("coalesces both brief fields into one op", () => {
    const saved = sampleKit();
    const drafts = draftsFromKit(saved);
    const ops = buildBriefRoleOps(
      saved,
      { summary: "New summary", what_they_do: "New what" },
      drafts.requirements,
    );
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({
      op: "update",
      target: "brief",
      set: { summary: "New summary", what_they_do: "New what" },
    });
  });
});

describe("buildQuestionTextOps / buildPendingTextOps", () => {
  it("emits prompt and outline update ops", () => {
    const saved = sampleKit();
    const drafts = draftsFromKit(saved);
    const ops = buildQuestionTextOps(
      saved,
      drafts.questions.map((q) =>
        q.id === "q1"
          ? { ...q, prompt: "Explain hooks deeply", answer_outline: "detail" }
          : q,
      ),
    );
    expect(ops).toEqual([
      {
        op: "update",
        target: "question",
        id: "q1",
        set: { prompt: "Explain hooks deeply", answer_outline: "detail" },
      },
    ]);
  });

  it("combines brief and question text ops for flush-before-regen", () => {
    const saved = sampleKit();
    const drafts = draftsFromKit(saved);
    const ops = buildPendingTextOps(
      saved,
      { ...drafts.brief, summary: "Changed brief" },
      drafts.requirements,
      drafts.questions.map((q) =>
        q.id === "q1" ? { ...q, prompt: "Changed prompt" } : q,
      ),
    );
    expect(ops).toHaveLength(2);
    expect(ops[0]?.target).toBe("brief");
    expect(ops[1]).toMatchObject({
      op: "update",
      target: "question",
      id: "q1",
    });
  });
});

describe("reorder / move / pin", () => {
  it("reorders within a category optimistically", () => {
    const qs = sampleQuestions();
    const next = reorderQuestionsInCategory(qs, "technical", "q1", "q3");
    expect(
      next.filter((q) => q.category === "technical").map((q) => q.id),
    ).toEqual(["q2", "q3", "q1"]);
    expect(next.find((q) => q.id === "q4")?.category).toBe("behavioural");
  });

  it("moves a question to another category", () => {
    const next = moveQuestionCategory(sampleQuestions(), "q1", "company-fit");
    expect(next.find((q) => q.id === "q1")?.category).toBe("company-fit");
  });

  it("toggles pin on meta", () => {
    const next = setQuestionPinned(sampleQuestions(), "q1", true);
    expect(next.find((q) => q.id === "q1")?.meta?.pinned).toBe(true);
  });
});

describe("isNetworkError", () => {
  it("treats TypeError and failed-to-fetch as offline", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new Error("VALIDATION"))).toBe(false);
  });
});
