import { describe, expect, it } from "vitest";
import type { PracticeNextItem, PracticeRequirementStat } from "./api";
import {
  applyPracticeKey,
  coveredRequirements,
  createPracticeSession,
  currentCard,
  isRevealKey,
  notCoveredRequirements,
  parseConfidenceKey,
  practiceKeyAction,
  runKeyboardSession,
  sessionProgress,
} from "./practice";

function item(
  partial: Partial<PracticeNextItem> & Pick<PracticeNextItem, "flashcardId">,
): PracticeNextItem {
  return {
    front: `front-${partial.flashcardId}`,
    back: `back-${partial.flashcardId}`,
    requirement_ids: ["r1"],
    box: null,
    lastConfidence: null,
    lastSeenAt: null,
    ...partial,
  };
}

describe("sessionProgress", () => {
  it("reports ratio and label", () => {
    expect(sessionProgress(0, 4)).toEqual({
      reviewed: 0,
      total: 4,
      ratio: 0,
      label: "0 / 4",
    });
    expect(sessionProgress(2, 4).ratio).toBe(0.5);
    expect(sessionProgress(4, 4).ratio).toBe(1);
  });

  it("handles empty queue", () => {
    expect(sessionProgress(0, 0)).toEqual({
      reviewed: 0,
      total: 0,
      ratio: 0,
      label: "0 / 0",
    });
  });
});

describe("practice key mapping", () => {
  it("Space and Enter reveal on the front only", () => {
    expect(isRevealKey(" ")).toBe(true);
    expect(isRevealKey("Enter")).toBe(true);
    expect(practiceKeyAction("front", " ")).toEqual({ type: "reveal" });
    expect(practiceKeyAction("front", "Enter")).toEqual({ type: "reveal" });
    expect(practiceKeyAction("back", " ")).toEqual({ type: "none" });
  });

  it("1–5 rate only after reveal", () => {
    expect(parseConfidenceKey("4")).toBe(4);
    expect(parseConfidenceKey("0")).toBeNull();
    expect(practiceKeyAction("front", "3")).toEqual({ type: "none" });
    expect(practiceKeyAction("back", "5")).toEqual({
      type: "review",
      confidence: 5,
    });
  });
});

describe("keyboard-only one session (Verify)", () => {
  it("preserves API next-session order and completes via Space + 1–5", () => {
    // Order as returned by GET /practice/next (never-seen interleaved early).
    const items = [
      item({ flashcardId: "f3", box: null }),
      item({ flashcardId: "f1", box: 1, lastConfidence: 2 }),
      item({ flashcardId: "f2", box: 2, lastConfidence: 4 }),
    ];

    const final = runKeyboardSession(items, [2, 4, 5]);

    expect(final.done).toBe(true);
    expect(final.reviews.map((r) => r.flashcardId)).toEqual([
      "f3",
      "f1",
      "f2",
    ]);
    expect(final.reviews.map((r) => r.confidence)).toEqual([2, 4, 5]);
    expect(sessionProgress(final.reviews.length, items.length).ratio).toBe(1);
  });

  it("steps front → reveal → review → next card with applyPracticeKey", () => {
    let state = createPracticeSession([
      item({ flashcardId: "f1" }),
      item({ flashcardId: "f2" }),
    ]);
    expect(currentCard(state)?.flashcardId).toBe("f1");
    expect(state.phase).toBe("front");

    ({ state } = applyPracticeKey(state, "Enter"));
    expect(state.phase).toBe("back");

    // Confidence before reveal is ignored
    const ignored = applyPracticeKey(
      { ...state, phase: "front" },
      "1",
    );
    expect(ignored.action.type).toBe("none");

    ({ state } = applyPracticeKey(state, "1"));
    expect(state.reviews).toHaveLength(1);
    expect(state.reviews[0]?.confidence).toBe(1);
    expect(currentCard(state)?.flashcardId).toBe("f2");
    expect(state.phase).toBe("front");
    expect(state.done).toBe(false);

    ({ state } = applyPracticeKey(state, " "));
    ({ state } = applyPracticeKey(state, "5"));
    expect(state.done).toBe(true);
    expect(state.reviews).toHaveLength(2);
  });

  it("empty queue is immediately done", () => {
    const state = createPracticeSession([]);
    expect(state.done).toBe(true);
    expect(currentCard(state)).toBeNull();
  });
});

describe("coverage grid helpers", () => {
  const reqs: PracticeRequirementStat[] = [
    { id: "r1", text: "React", priority: "must", covered: true },
    { id: "r2", text: "Mentoring", priority: "must", covered: false },
  ];

  it("splits covered vs not-covered", () => {
    expect(coveredRequirements(reqs).map((r) => r.id)).toEqual(["r1"]);
    expect(notCoveredRequirements(reqs).map((r) => r.id)).toEqual(["r2"]);
  });
});
