import { describe, expect, it } from "vitest";
import {
  assignStoryIds,
  contentTokens,
  hintStoriesForFlashcard,
  mapStoryBank,
  stemToken,
  uncoveredMessage,
  type StarStory,
} from "./mapStories.js";

const mentoringStory: StarStory = {
  id: "s1",
  title: "Mentored a new hire",
  situation: "Our squad onboarded two junior engineers during a busy quarter.",
  task: "I needed to mentor them without slipping delivery.",
  action: "I ran weekly pairing and a checklist for first PRs.",
  result: "Both juniors shipped independently within six weeks.",
};

const conflictStory: StarStory = {
  id: "s2",
  title: "Stakeholder disagreement",
  situation: "Product and design disagreed on scope for a launch.",
  task: "I had to resolve the conflict and keep the date.",
  action: "I facilitated a trade-off workshop with written options.",
  result: "We shipped a smaller slice on time and followed up later.",
};

const reactStory: StarStory = {
  id: "s3",
  title: "React rewrite",
  situation: "The dashboard was a jQuery SPA.",
  task: "Rewrite the UI in React.",
  action: "I migrated screens incrementally.",
  result: "Bundle size dropped and load time improved.",
};

describe("stemToken / contentTokens", () => {
  it("stems mentoring/mentored/juniors for overlap", () => {
    expect(stemToken("mentoring")).toBe("mentor");
    expect(stemToken("mentored")).toBe("mentor");
    expect(stemToken("juniors")).toBe("junior");
    expect(contentTokens("mentoring juniors")).toEqual(["mentor", "junior"]);
  });
});

describe("assignStoryIds", () => {
  it("assigns s1.. in order and caps at 6", () => {
    const drafts = Array.from({ length: 8 }, (_, i) => ({
      title: `T${i}`,
      situation: "s",
      task: "t",
      action: "a",
      result: "r",
    }));
    const stories = assignStoryIds(drafts);
    expect(stories.map((s) => s.id)).toEqual([
      "s1",
      "s2",
      "s3",
      "s4",
      "s5",
      "s6",
    ]);
  });
});

describe("mapStoryBank", () => {
  const requirements = [
    {
      id: "r1",
      text: "5 years React",
      kind: "technical" as const,
      priority: "must" as const,
    },
    {
      id: "r2",
      text: "mentoring juniors",
      kind: "behavioural" as const,
      priority: "must" as const,
    },
    {
      id: "r3",
      text: "handles conflict with stakeholders",
      kind: "behavioural" as const,
      priority: "nice" as const,
    },
  ];

  const questions = [
    {
      id: "q1",
      prompt: "Walk through a React performance fix",
      answer_outline: "profiling",
      category: "technical" as const,
      requirement_ids: ["r1"],
    },
    {
      id: "q2",
      prompt: "Tell me about mentoring a junior engineer",
      answer_outline: "STAR pairing",
      category: "behavioural" as const,
      requirement_ids: ["r2"],
    },
  ];

  it("maps mentoring requirement and question onto the mentoring story", () => {
    const mapped = mapStoryBank(
      [mentoringStory, conflictStory, reactStory],
      requirements,
      questions,
    );
    const r2 = mapped.requirements.find((r) => r.requirementId === "r2");
    expect(r2?.candidates[0]?.storyId).toBe("s1");
    expect(r2?.candidates[0]?.overlappingTerms).toEqual(
      expect.arrayContaining(["mentor", "junior"]),
    );

    const q2 = mapped.questions.find((q) => q.questionId === "q2");
    expect(q2?.candidates[0]?.storyId).toBe("s1");
    expect(mapped.questions.some((q) => q.questionId === "q1")).toBe(false);
  });

  it("flags behavioural requirements with no overlapping story", () => {
    const mapped = mapStoryBank([reactStory], requirements, questions);
    expect(mapped.uncovered.map((u) => u.requirementId).sort()).toEqual([
      "r2",
      "r3",
    ]);
    expect(mapped.uncovered.find((u) => u.requirementId === "r2")?.message).toBe(
      uncoveredMessage("mentoring juniors"),
    );
    expect(mapped.uncovered.find((u) => u.requirementId === "r2")?.message).toBe(
      "You have no story for 'mentoring juniors'",
    );
  });

  it("ignores technical requirements in uncovered list", () => {
    const mapped = mapStoryBank([], requirements, questions);
    expect(mapped.requirements.every((r) => r.requirementId !== "r1")).toBe(
      true,
    );
    expect(mapped.uncovered.some((u) => u.requirementId === "r1")).toBe(false);
  });

  it("does not match a React story to mentoring juniors", () => {
    const mapped = mapStoryBank([reactStory], requirements, []);
    const r2 = mapped.requirements.find((r) => r.requirementId === "r2");
    expect(r2?.candidates).toEqual([]);
  });
});

describe("hintStoriesForFlashcard", () => {
  it("uses linked behavioural requirement matches first", () => {
    const stories = [mentoringStory, conflictStory];
    const mapping = mapStoryBank(
      stories,
      [
        {
          id: "r2",
          text: "mentoring juniors",
          kind: "behavioural",
          priority: "must",
        },
      ],
      [],
    );
    const hints = hintStoriesForFlashcard(stories, mapping, {
      front: "How do you grow people?",
      back: "pairing",
      requirement_ids: ["r2"],
    });
    expect(hints[0]?.storyId).toBe("s1");
  });
});
