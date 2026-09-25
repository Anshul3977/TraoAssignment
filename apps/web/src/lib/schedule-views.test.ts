import { describe, expect, it } from "vitest";
import type { KitQuestion } from "./api";
import {
  buildCoverageMatrix,
  buildScheduleDayCards,
  interviewDateFromCreatedAt,
  scheduleDayDate,
  toLocalDateKey,
  todayScheduleDay,
} from "./schedule-views";

const QUESTIONS: KitQuestion[] = [
  {
    id: "q1",
    requirement_ids: ["r1"],
    category: "technical",
    prompt: "Explain React hooks",
    answer_outline: "useState",
    difficulty: 2,
  },
  {
    id: "q2",
    requirement_ids: ["r1", "r2"],
    category: "technical",
    prompt: "Scale a React app",
    answer_outline: "code split",
    difficulty: 3,
  },
  {
    id: "q3",
    requirement_ids: ["r2"],
    category: "behavioural",
    prompt: "Tell me about mentoring",
    answer_outline: "STAR",
    difficulty: 2,
  },
];

describe("interview / today marker", () => {
  it("derives interview date as createdAt + daysAvailable", () => {
    const created = new Date(2026, 8, 25); // local 25 Sep 2026
    const interview = interviewDateFromCreatedAt(created, 5);
    expect(toLocalDateKey(interview)).toBe("2026-09-30");
  });

  it("maps schedule day 1 to createdAt local date", () => {
    const created = "2026-09-25T15:30:00.000Z";
    const d1 = scheduleDayDate(created, 1);
    const d3 = scheduleDayDate(created, 3);
    // Use local keys relative to the same created parsing
    const startKey = toLocalDateKey(scheduleDayDate(created, 1));
    expect(toLocalDateKey(d1)).toBe(startKey);
    const expectedDay3 = new Date(d1);
    expectedDay3.setDate(expectedDay3.getDate() + 2);
    expect(toLocalDateKey(d3)).toBe(toLocalDateKey(expectedDay3));
  });

  it("marks today as the matching schedule day within the window", () => {
    const created = new Date(2026, 8, 25);
    const day2 = new Date(2026, 8, 26);
    expect(todayScheduleDay(created, 5, day2)).toBe(2);
    expect(todayScheduleDay(created, 5, created)).toBe(1);
    expect(todayScheduleDay(created, 5, new Date(2026, 8, 29))).toBe(5);
  });

  it("returns null when today is outside the prep window", () => {
    const created = new Date(2026, 8, 25);
    expect(todayScheduleDay(created, 5, new Date(2026, 8, 24))).toBeNull();
    expect(todayScheduleDay(created, 5, new Date(2026, 8, 30))).toBeNull();
    expect(todayScheduleDay(created, 0, created)).toBeNull();
  });
});

describe("buildScheduleDayCards", () => {
  it("links questions by id and flags today", () => {
    const created = new Date(2026, 8, 25);
    const now = new Date(2026, 8, 26);
    const cards = buildScheduleDayCards(
      {
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
            question_ids: ["q2", "q3"],
            minutes: 50,
          },
        ],
      },
      QUESTIONS,
      created,
      now,
    );
    expect(cards).toHaveLength(2);
    expect(cards[0]!.isToday).toBe(false);
    expect(cards[1]!.isToday).toBe(true);
    expect(cards[1]!.questions.map((q) => q.id)).toEqual(["q2", "q3"]);
    expect(cards[1]!.questions[0]!.prompt).toBe("Scale a React app");
    expect(cards[0]!.focus).toBe("Technical foundations");
    expect(cards[0]!.minutes).toBe(40);
  });
});

describe("buildCoverageMatrix", () => {
  it("builds requirements×questions cells and highlights uncovered gaps", () => {
    const matrix = buildCoverageMatrix(
      [
        { id: "r1", text: "Know React", priority: "must" },
        { id: "r2", text: "Mentors juniors", priority: "nice" },
        { id: "r3", text: "Knows COBOL", priority: "nice" },
      ],
      QUESTIONS,
      ["r2", "r3"],
    );

    expect(matrix.questionIds).toEqual(["q1", "q2", "q3"]);
    expect(matrix.rows).toHaveLength(3);

    const r1 = matrix.rows[0]!;
    expect(r1.gap).toBe(false);
    expect(r1.cells.map((c) => c.linked)).toEqual([true, true, false]);

    const r2 = matrix.rows[1]!;
    expect(r2.gap).toBe(true);
    expect(r2.cells.map((c) => c.linked)).toEqual([false, true, true]);

    const r3 = matrix.rows[2]!;
    expect(r3.gap).toBe(true);
    expect(r3.cells.every((c) => !c.linked)).toBe(true);

    // Verify: matrix highlights uncovered_requirement_ids
    const gapIds = matrix.rows.filter((r) => r.gap).map((r) => r.requirementId);
    expect(gapIds).toEqual(["r2", "r3"]);
  });

  it("marks no gaps when uncovered list is empty", () => {
    const matrix = buildCoverageMatrix(
      [{ id: "r1", text: "Know React", priority: "must" }],
      QUESTIONS,
      [],
    );
    expect(matrix.rows.every((r) => !r.gap)).toBe(true);
  });
});
