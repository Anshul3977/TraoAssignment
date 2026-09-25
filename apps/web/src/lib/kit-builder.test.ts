import { describe, expect, it } from "vitest";
import type { KitDocument, KitFlashcard, KitQuestion } from "./api";
import {
  SAVE_DEBOUNCE_MS,
  buildBriefRoleOps,
  buildFlashcardTextOps,
  buildPendingTextOps,
  buildQuestionTextOps,
  categoryTabLabel,
  coverageIndicator,
  draftsFromKit,
  isNetworkError,
  isProtectedBrief,
  isProtectedQuestion,
  itemBadges,
  moveQuestionCategory,
  questionsKeptOnRegen,
  questionsReplacedOnRegen,
  removeFlashcard,
  reorderQuestionsInCategory,
  saveStatusLabel,
  scheduleSummary,
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

function sampleFlashcards(): KitFlashcard[] {
  return [
    {
      id: "f1",
      front: "What is React?",
      back: "A UI library",
      requirement_ids: ["r1"],
      meta: { origin: "generated", edited: false },
    },
    {
      id: "f2",
      front: "Mentoring tip",
      back: "Pair weekly",
      requirement_ids: ["r2"],
      meta: { origin: "user", edited: true },
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
    flashcards: sampleFlashcards(),
    schedule: {
      days_available: 2,
      days: [
        {
          day: 1,
          focus: "Technical foundations",
          question_ids: ["q1"],
          minutes: 40,
        },
        {
          day: 2,
          focus: "Mock interview + weak spots",
          question_ids: ["q2", "q4"],
          minutes: 50,
        },
      ],
    },
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

describe("isProtectedBrief", () => {
  it("protects edited and user-origin briefs for confirm/keep UX", () => {
    expect(isProtectedBrief({ edited: true })).toBe(true);
    expect(isProtectedBrief({ origin: "user" })).toBe(true);
    expect(isProtectedBrief({ origin: "generated", edited: false })).toBe(
      false,
    );
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

describe("buildQuestionTextOps / buildFlashcardTextOps / buildPendingTextOps", () => {
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

  it("emits flashcard front/back update ops", () => {
    const saved = sampleKit();
    const drafts = draftsFromKit(saved);
    const ops = buildFlashcardTextOps(
      saved,
      drafts.flashcards.map((f) =>
        f.id === "f1"
          ? { ...f, front: "What is React really?", back: "UI library + ecosystem" }
          : f,
      ),
    );
    expect(ops).toEqual([
      {
        op: "update",
        target: "flashcard",
        id: "f1",
        set: {
          front: "What is React really?",
          back: "UI library + ecosystem",
        },
      },
    ]);
  });

  it("skips empty flashcard strings", () => {
    const saved = sampleKit();
    const drafts = draftsFromKit(saved);
    expect(
      buildFlashcardTextOps(
        saved,
        drafts.flashcards.map((f) =>
          f.id === "f1" ? { ...f, front: "   ", back: "" } : f,
        ),
      ),
    ).toEqual([]);
  });

  it("combines brief, question, and flashcard text ops for flush-before-regen", () => {
    const saved = sampleKit();
    const drafts = draftsFromKit(saved);
    const ops = buildPendingTextOps(
      saved,
      { ...drafts.brief, summary: "Changed brief" },
      drafts.requirements,
      drafts.questions.map((q) =>
        q.id === "q1" ? { ...q, prompt: "Changed prompt" } : q,
      ),
      drafts.flashcards.map((f) =>
        f.id === "f1" ? { ...f, front: "Changed front" } : f,
      ),
    );
    expect(ops).toHaveLength(3);
    expect(ops[0]?.target).toBe("brief");
    expect(ops[1]).toMatchObject({
      op: "update",
      target: "question",
      id: "q1",
    });
    expect(ops[2]).toMatchObject({
      op: "update",
      target: "flashcard",
      id: "f1",
    });
  });

  it("draftsFromKit includes flashcards", () => {
    const drafts = draftsFromKit(sampleKit());
    expect(drafts.flashcards).toEqual([
      { id: "f1", front: "What is React?", back: "A UI library" },
      { id: "f2", front: "Mentoring tip", back: "Pair weekly" },
    ]);
  });
});

describe("scheduleSummary / removeFlashcard", () => {
  it("summarises schedule without mutating it", () => {
    const schedule = sampleKit().schedule;
    expect(scheduleSummary(schedule)).toEqual({
      daysAvailable: 2,
      dayCount: 2,
      totalMinutes: 90,
    });
    expect(scheduleSummary(null)).toEqual({
      daysAvailable: 0,
      dayCount: 0,
      totalMinutes: 0,
    });
  });

  it("removes a flashcard locally for optimistic delete", () => {
    const next = removeFlashcard(sampleFlashcards(), "f1");
    expect(next.map((f) => f.id)).toEqual(["f2"]);
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
