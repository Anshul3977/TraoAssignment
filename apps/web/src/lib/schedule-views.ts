/**
 * Pure helpers for schedule day cards + requirements×questions coverage matrix (T25).
 * Interview date is derived client-side from kit createdAt + days (no extra API field).
 */

import type {
  KitQuestion,
  KitSchedule,
  KitScheduleDay,
} from "./api";

export type ScheduleLinkedQuestion = {
  id: string;
  prompt: string;
  category: string;
  difficulty: number;
  requirement_ids: string[];
};

export type ScheduleDayCard = {
  day: number;
  focus: string;
  minutes: number;
  questionIds: string[];
  questions: ScheduleLinkedQuestion[];
  /** ISO date (YYYY-MM-DD) for this prep day in local time. */
  date: string;
  isToday: boolean;
};

export type CoverageMatrixCell = {
  requirementId: string;
  questionId: string;
  linked: boolean;
};

export type CoverageMatrixRow = {
  requirementId: string;
  text: string;
  priority: string;
  /** True when id is in kit.coverage.uncovered_requirement_ids (§8 visibility). */
  gap: boolean;
  cells: CoverageMatrixCell[];
};

export type CoverageMatrix = {
  questionIds: string[];
  rows: CoverageMatrixRow[];
};

/** Local calendar YYYY-MM-DD (no UTC shift). */
export function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Prep starts on the kit's created calendar day.
 * Interview is `daysAvailable` calendar days after that start
 * (SPEC: user says how many days until the interview).
 */
export function interviewDateFromCreatedAt(
  createdAt: string | Date,
  daysAvailable: number,
): Date {
  const start = startOfLocalDay(
    typeof createdAt === "string" ? new Date(createdAt) : createdAt,
  );
  const interview = new Date(start);
  interview.setDate(interview.getDate() + Math.max(0, daysAvailable));
  return interview;
}

/** Calendar date for schedule day `day` (1-based) given kit createdAt. */
export function scheduleDayDate(
  createdAt: string | Date,
  day: number,
): Date {
  const start = startOfLocalDay(
    typeof createdAt === "string" ? new Date(createdAt) : createdAt,
  );
  const result = new Date(start);
  result.setDate(result.getDate() + Math.max(0, day - 1));
  return result;
}

/**
 * Which schedule day number is "today", or null if outside the prep window.
 * Day 1 = createdAt local date; day N = day before interview.
 */
export function todayScheduleDay(
  createdAt: string | Date,
  daysAvailable: number,
  now: Date = new Date(),
): number | null {
  if (daysAvailable < 1) return null;
  const start = startOfLocalDay(
    typeof createdAt === "string" ? new Date(createdAt) : createdAt,
  );
  const today = startOfLocalDay(now);
  const diffMs = today.getTime() - start.getTime();
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
  if (diffDays < 0 || diffDays >= daysAvailable) return null;
  return diffDays + 1;
}

export function buildScheduleDayCards(
  schedule: KitSchedule,
  questions: readonly KitQuestion[],
  createdAt: string | Date,
  now: Date = new Date(),
): ScheduleDayCard[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const todayDay = todayScheduleDay(
    createdAt,
    schedule.days_available,
    now,
  );
  const days = schedule.days ?? [];
  return days.map((d: KitScheduleDay) => {
    const linked: ScheduleLinkedQuestion[] = d.question_ids.map((id) => {
      const q = byId.get(id);
      if (q) {
        return {
          id: q.id,
          prompt: q.prompt,
          category: String(q.category),
          difficulty: q.difficulty,
          requirement_ids: [...q.requirement_ids],
        };
      }
      return {
        id,
        prompt: "(missing question)",
        category: "",
        difficulty: 0,
        requirement_ids: [],
      };
    });
    const date = scheduleDayDate(createdAt, d.day);
    return {
      day: d.day,
      focus: d.focus,
      minutes: d.minutes,
      questionIds: [...d.question_ids],
      questions: linked,
      date: toLocalDateKey(date),
      isToday: todayDay === d.day,
    };
  });
}

/**
 * Requirements × questions matrix. Gap rows are those listed in
 * `uncovered_requirement_ids` (pipeline coverage, not recomputed client-side).
 */
export function buildCoverageMatrix(
  requirements: readonly {
    id: string;
    text: string;
    priority: string;
  }[],
  questions: readonly KitQuestion[],
  uncoveredRequirementIds: readonly string[],
): CoverageMatrix {
  const uncovered = new Set(uncoveredRequirementIds);
  const questionIds = questions.map((q) => q.id);
  const rows: CoverageMatrixRow[] = requirements.map((r) => ({
    requirementId: r.id,
    text: r.text,
    priority: r.priority,
    gap: uncovered.has(r.id),
    cells: questions.map((q) => ({
      requirementId: r.id,
      questionId: q.id,
      linked: q.requirement_ids.includes(r.id),
    })),
  }));
  return { questionIds, rows };
}
