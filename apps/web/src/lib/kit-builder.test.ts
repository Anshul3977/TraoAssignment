import { describe, expect, it } from "vitest";
import type { KitDocument } from "./api";
import {
  SAVE_DEBOUNCE_MS,
  buildBriefRoleOps,
  coverageIndicator,
  draftsFromKit,
  isNetworkError,
  itemBadges,
  saveStatusLabel,
} from "./kit-builder";

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
    questions: [],
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
  it("shows Edited and origin badges", () => {
    expect(itemBadges({ edited: true, origin: "generated" })).toEqual([
      { key: "edited", label: "Edited" },
      { key: "ai", label: "AI" },
    ]);
    expect(itemBadges({ origin: "user" })).toEqual([
      { key: "yours", label: "Yours" },
    ]);
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

describe("isNetworkError", () => {
  it("treats TypeError and failed-to-fetch as offline", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new Error("VALIDATION"))).toBe(false);
  });
});
