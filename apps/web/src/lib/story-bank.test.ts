import { describe, expect, it } from "vitest";
import {
  completeStories,
  emptyStoryDraft,
  isCompleteStory,
  storyCountHint,
} from "./story-bank";

describe("completeStories", () => {
  it("drops incomplete drafts and caps at 6", () => {
    const full = {
      title: "T",
      situation: "S",
      task: "K",
      action: "A",
      result: "R",
    };
    const drafts = [
      emptyStoryDraft(),
      full,
      { ...full, title: "  " },
      ...Array.from({ length: 6 }, () => full),
    ];
    expect(completeStories(drafts)).toHaveLength(6);
    expect(isCompleteStory(emptyStoryDraft())).toBe(false);
  });
});

describe("storyCountHint", () => {
  it("prompts for 4–6 when empty", () => {
    expect(storyCountHint(0)).toMatch(/4–6/);
    expect(storyCountHint(2)).toMatch(/2 of 4–6/);
    expect(storyCountHint(4)).toMatch(/4 of 6/);
  });
});
