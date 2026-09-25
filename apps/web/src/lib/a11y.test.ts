import { describe, expect, it } from "vitest";
import {
  FOCUSABLE_SELECTOR,
  KEYBOARD_CHECKLIST,
  PHONE_LAYOUT,
  PHONE_MIN_WIDTH_PX,
  isTabKey,
  keyboardFlowIds,
  nextCategoryIndex,
  nextFocusIndex,
  phoneLayoutFits,
  queryFocusable,
} from "./a11y";

describe("nextFocusIndex (dialog Tab trap)", () => {
  it("wraps forward from the last control to the first", () => {
    expect(nextFocusIndex(3, 2, false)).toBe(0);
  });

  it("wraps backward from the first control to the last", () => {
    expect(nextFocusIndex(3, 0, true)).toBe(2);
  });

  it("steps inside the list", () => {
    expect(nextFocusIndex(3, 0, false)).toBe(1);
    expect(nextFocusIndex(3, 1, true)).toBe(0);
  });

  it("returns -1 when there are no focusable nodes", () => {
    expect(nextFocusIndex(0, 0, false)).toBe(-1);
  });

  it("starts at first/last when current is outside the list", () => {
    expect(nextFocusIndex(2, -1, false)).toBe(0);
    expect(nextFocusIndex(2, -1, true)).toBe(1);
  });
});

describe("nextCategoryIndex (question tabs)", () => {
  it("wraps ArrowRight from the last tab", () => {
    expect(nextCategoryIndex(4, 3, "ArrowRight")).toBe(0);
  });

  it("wraps ArrowLeft from the first tab", () => {
    expect(nextCategoryIndex(4, 0, "ArrowLeft")).toBe(3);
  });

  it("jumps Home/End", () => {
    expect(nextCategoryIndex(4, 2, "Home")).toBe(0);
    expect(nextCategoryIndex(4, 1, "End")).toBe(3);
  });

  it("recognises tab keys used by the checklist", () => {
    expect(isTabKey("ArrowLeft")).toBe(true);
    expect(isTabKey("Tab")).toBe(false);
  });
});

describe("queryFocusable", () => {
  it("uses the shared selector", () => {
    const calls: string[] = [];
    const nodes = [{ id: "a" }, { id: "b" }];
    queryFocusable({
      querySelectorAll(sel: string) {
        calls.push(sel);
        return nodes as unknown as ArrayLike<Element>;
      },
    });
    expect(calls).toEqual([FOCUSABLE_SELECTOR]);
  });
});

describe("keyboard-only checklist", () => {
  it("covers every flow named in T27 Verify", () => {
    expect(keyboardFlowIds()).toEqual([
      "auth",
      "dashboard",
      "create-kit",
      "batch",
      "job-progress",
      "builder-edit",
      "questions-tabs",
      "questions-dnd",
      "dialogs",
      "practice",
      "schedule-coverage",
      "story-bank",
    ]);
  });

  it("requires Escape + Tab on dialogs and 1–5 on practice", () => {
    const dialogs = KEYBOARD_CHECKLIST.find((f) => f.id === "dialogs");
    const practice = KEYBOARD_CHECKLIST.find((f) => f.id === "practice");
    expect(dialogs?.keys).toEqual(expect.arrayContaining(["Tab", "Escape"]));
    expect(practice?.keys).toEqual(
      expect.arrayContaining(["Space", "Enter", "1", "5"]),
    );
  });

  it("keeps a title on every row (manual walkthrough sheet)", () => {
    for (const flow of KEYBOARD_CHECKLIST) {
      expect(flow.title.length).toBeGreaterThan(3);
      expect(flow.keys.length).toBeGreaterThan(0);
    }
  });
});

describe("375px smoke", () => {
  it("treats 375px as the minimum supported width", () => {
    expect(PHONE_MIN_WIDTH_PX).toBe(375);
    expect(phoneLayoutFits(375)).toBe(true);
    expect(phoneLayoutFits(1440)).toBe(true);
    expect(phoneLayoutFits(320)).toBe(false);
  });

  it("uses compact gutters and horizontal scroll tokens (no page overflow)", () => {
    expect(PHONE_LAYOUT.shellHeader).toContain("px-4");
    expect(PHONE_LAYOUT.shellMain).toContain("px-4");
    expect(PHONE_LAYOUT.section).toContain("p-4");
    expect(PHONE_LAYOUT.overflowX).toBe("overflow-x-auto");
    expect(PHONE_LAYOUT.minWidth).toBe("min-w-0");
    expect(PHONE_LAYOUT.skipHref).toBe("#main");
    expect(PHONE_LAYOUT.tap).toContain("min-h-11");
  });
});
