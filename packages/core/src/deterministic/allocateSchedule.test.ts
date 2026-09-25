import { describe, expect, it } from "vitest";
import {
  allocateSchedule,
  learningDayCount,
  meanDayScore,
  scoreQuestion,
  type ScheduleQuestion,
  type ScheduleRequirement,
} from "./allocateSchedule.js";

function req(
  id: string,
  priority: ScheduleRequirement["priority"],
  text = id,
): ScheduleRequirement {
  return { id, priority, text };
}

function q(
  id: string,
  requirement_ids: string[],
  difficulty: 1 | 2 | 3,
  category: ScheduleQuestion["category"] = "technical",
): ScheduleQuestion {
  return { id, requirement_ids, difficulty, category };
}

/** Small bank: must + nice, varied difficulty, sole-must cover on q1. */
function sampleBank(): {
  requirements: ScheduleRequirement[];
  questions: ScheduleQuestion[];
} {
  const requirements = [
    req("r1", "must", "Strong TypeScript"),
    req("r2", "must", "System design at scale"),
    req("r3", "nice", "GraphQL familiarity"),
    req("r4", "must", "Clear communication"),
  ];
  const questions = [
    q("q1", ["r1"], 3, "technical"), // sole cover for r1
    q("q2", ["r2"], 3, "system-design"),
    q("q3", ["r2", "r3"], 2, "technical"),
    q("q4", ["r4"], 1, "behavioural"),
    q("q5", ["r3"], 1, "technical"),
    q("q6", ["r4"], 2, "behavioural"),
  ];
  return { requirements, questions };
}

function assertValidSchedule(
  daysAvailable: number,
  requirements: ScheduleRequirement[],
  questions: ScheduleQuestion[],
): ReturnType<typeof allocateSchedule> {
  const result = allocateSchedule(requirements, questions, daysAvailable);
  const { schedule } = result;

  expect(schedule.days_available).toBe(daysAvailable);
  expect(schedule.days).toHaveLength(daysAvailable);

  const qIds = new Set(questions.map((x) => x.id));
  for (const day of schedule.days) {
    expect(Number.isInteger(day.day)).toBe(true);
    expect(Number.isInteger(day.minutes)).toBe(true);
    expect(day.minutes).toBeGreaterThanOrEqual(0);
    for (const id of day.question_ids) {
      expect(qIds.has(id)).toBe(true);
    }
  }

  if (daysAvailable > 0) {
    expect(schedule.days[daysAvailable - 1]!.focus).toBe(
      "Mock interview + weak spots",
    );
  }

  // Every must appears via some scheduled question's requirement_ids
  if (questions.length > 0) {
    const scheduled = new Set<string>();
    for (const day of schedule.days) {
      for (const id of day.question_ids) scheduled.add(id);
    }
    const covered = new Set<string>();
    for (const qq of questions) {
      if (!scheduled.has(qq.id)) continue;
      for (const rid of qq.requirement_ids) covered.add(rid);
    }
    for (const r of requirements) {
      if (r.priority === "must") {
        expect(covered.has(r.id)).toBe(true);
      }
    }
  }

  // No empty days when questions exist
  if (questions.length > 0) {
    for (const day of schedule.days) {
      expect(day.question_ids.length).toBeGreaterThan(0);
    }
  }

  return result;
}

describe("scoreQuestion", () => {
  it("uses max priority weight × 10 + difficulty × 3 + sole-must bonus", () => {
    const requirements = [
      req("r1", "must"),
      req("r2", "nice"),
    ];
    const questions = [
      q("q1", ["r1"], 3), // sole must → +5
      q("q2", ["r2"], 1),
    ];
    // must=2 → 20 + 9 + 5 = 34
    expect(scoreQuestion(questions[0]!, questions, requirements)).toBe(34);
    // nice=1 → 10 + 3 + 0 = 13
    expect(scoreQuestion(questions[1]!, questions, requirements)).toBe(13);
  });

  it("does not give sole-must bonus when two questions cover the must", () => {
    const requirements = [req("r1", "must")];
    const questions = [q("q1", ["r1"], 2), q("q2", ["r1"], 1)];
    // weight 2 × 10 + 2 × 3 + 0 = 26
    expect(scoreQuestion(questions[0]!, questions, requirements)).toBe(26);
  });
});

describe("learningDayCount", () => {
  it("is ceil(N×0.7) with a minimum of 1", () => {
    expect(learningDayCount(1)).toBe(1);
    expect(learningDayCount(2)).toBe(2);
    expect(learningDayCount(5)).toBe(4);
    expect(learningDayCount(14)).toBe(10);
    expect(learningDayCount(60)).toBe(42);
  });
});

describe("allocateSchedule", () => {
  it("builds N=1 schedule with mock focus and integer minutes", () => {
    const { requirements, questions } = sampleBank();
    const { schedule } = assertValidSchedule(1, requirements, questions);
    expect(schedule.days[0]!.focus).toBe("Mock interview + weak spots");
  });

  it("builds N=2 schedule", () => {
    const { requirements, questions } = sampleBank();
    assertValidSchedule(2, requirements, questions);
  });

  it("builds N=5 schedule with day-1 mean score ≥ last learning day", () => {
    const { requirements, questions } = sampleBank();
    const { schedule } = assertValidSchedule(5, requirements, questions);

    const scoreById = new Map(
      questions.map((qq) => [
        qq.id,
        scoreQuestion(qq, questions, requirements),
      ]),
    );
    const learnN = learningDayCount(5);
    const day1 = schedule.days[0]!;
    const lastLearn = schedule.days[learnN - 1]!;
    expect(meanDayScore(day1.question_ids, scoreById)).toBeGreaterThanOrEqual(
      meanDayScore(lastLearn.question_ids, scoreById),
    );
  });

  it("builds N=14 schedule", () => {
    const { requirements, questions } = sampleBank();
    assertValidSchedule(14, requirements, questions);
  });

  it("builds N=60 schedule without empty days", () => {
    const { requirements, questions } = sampleBank();
    const { schedule } = assertValidSchedule(60, requirements, questions);
    expect(schedule.days).toHaveLength(60);
  });

  it("handles 0 questions: exact day count, integers, mock last day", () => {
    const requirements = [req("r1", "must", "Anything")];
    const { schedule, notes } = allocateSchedule(requirements, [], 5);

    expect(schedule.days_available).toBe(5);
    expect(schedule.days).toHaveLength(5);
    for (const day of schedule.days) {
      expect(day.question_ids).toEqual([]);
      expect(Number.isInteger(day.minutes)).toBe(true);
      expect(day.minutes).toBe(0);
    }
    expect(schedule.days[4]!.focus).toBe("Mock interview + weak spots");
    expect(notes.schedule_overflow).toBeUndefined();
  });

  it("uses only integer minutes for every day", () => {
    const { requirements, questions } = sampleBank();
    for (const n of [1, 2, 5, 14, 60]) {
      const { schedule } = allocateSchedule(requirements, questions, n);
      for (const day of schedule.days) {
        expect(Number.isInteger(day.minutes)).toBe(true);
      }
    }
  });

  it("ensures every must requirement appears in the schedule", () => {
    const { requirements, questions } = sampleBank();
    for (const n of [1, 2, 5, 14]) {
      assertValidSchedule(n, requirements, questions);
    }
  });

  it("notes overflow when a single day must exceed the minute cap", () => {
    // Many high-difficulty questions forced onto N=1 → will exceed 180.
    const requirements = Array.from({ length: 20 }, (_, i) =>
      req(`r${i + 1}`, "must", `Skill ${i + 1}`),
    );
    const questions = requirements.map((r, i) =>
      q(`q${i + 1}`, [r.id], 3, "technical"),
    );
    const { schedule, notes } = allocateSchedule(requirements, questions, 1);
    expect(schedule.days).toHaveLength(1);
    expect(schedule.days[0]!.minutes).toBeGreaterThan(180);
    expect(notes.schedule_overflow).toBe(true);
    expect(notes.overflow_minutes).toBeGreaterThan(0);
  });

  it("returns empty days for non-positive daysAvailable", () => {
    const { requirements, questions } = sampleBank();
    const { schedule } = allocateSchedule(requirements, questions, 0);
    expect(schedule.days_available).toBe(0);
    expect(schedule.days).toEqual([]);
  });
});
