import type {
  Question,
  Requirement,
  ScheduleDay,
} from "../schema/kit.js";

/** Appendix A schedule shape — typed locally; `Schedule` is not exported from schema. */
export type AllocatedSchedule = {
  days_available: number;
  days: ScheduleDay[];
};

/** Minimal requirement fields needed for schedule scoring / coverage. */
export type ScheduleRequirement = Pick<
  Requirement,
  "id" | "priority" | "text"
>;

/** Minimal question fields needed for schedule allocation. */
export type ScheduleQuestion = Pick<
  Question,
  "id" | "requirement_ids" | "category" | "difficulty"
>;

export type AllocateScheduleNotes = {
  /** True when at least one day exceeded the per-day minute cap. */
  schedule_overflow?: boolean;
  /** Sum of minutes assigned beyond the per-day cap across all days. */
  overflow_minutes?: number;
};

export type AllocateScheduleResult = {
  schedule: AllocatedSchedule;
  notes: AllocateScheduleNotes;
};

const DAY_MINUTE_CAP = 180;
const MINUTES_BY_DIFFICULTY: Record<1 | 2 | 3, number> = {
  1: 10,
  2: 20,
  3: 30,
};

type ScoredQuestion = ScheduleQuestion & {
  score: number;
  minutes: number;
};

function questionMinutes(difficulty: 1 | 2 | 3): number {
  return MINUTES_BY_DIFFICULTY[difficulty];
}

function priorityWeight(
  q: ScheduleQuestion,
  reqById: Map<string, ScheduleRequirement>,
): number {
  let weight = 1;
  for (const rid of q.requirement_ids) {
    const r = reqById.get(rid);
    if (r?.priority === "must") weight = Math.max(weight, 2);
    else if (r?.priority === "nice") weight = Math.max(weight, 1);
  }
  return weight;
}

/** +5 when this question is the sole cover for at least one must requirement. */
function soleMustBonus(
  q: ScheduleQuestion,
  questions: ScheduleQuestion[],
  reqById: Map<string, ScheduleRequirement>,
): number {
  for (const rid of q.requirement_ids) {
    const r = reqById.get(rid);
    if (r?.priority !== "must") continue;
    let covers = 0;
    for (const other of questions) {
      if (other.requirement_ids.includes(rid)) covers += 1;
    }
    if (covers === 1) return 5;
  }
  return 0;
}

/** Exported for tests — score formula from T14. */
export function scoreQuestion(
  q: ScheduleQuestion,
  questions: ScheduleQuestion[],
  requirements: ScheduleRequirement[],
): number {
  const reqById = new Map(requirements.map((r) => [r.id, r]));
  return (
    priorityWeight(q, reqById) * 10 +
    q.difficulty * 3 +
    soleMustBonus(q, questions, reqById)
  );
}

function learningDayCount(n: number): number {
  if (n <= 0) return 0;
  return Math.max(1, Math.ceil(n * 0.7));
}

function dominantFocus(
  questionIds: string[],
  byId: Map<string, ScoredQuestion>,
  reqById: Map<string, ScheduleRequirement>,
): string {
  if (questionIds.length === 0) return "Review";

  const categoryCounts = new Map<string, number>();
  const reqCounts = new Map<string, number>();

  for (const id of questionIds) {
    const q = byId.get(id);
    if (!q) continue;
    categoryCounts.set(
      q.category,
      (categoryCounts.get(q.category) ?? 0) + 1,
    );
    for (const rid of q.requirement_ids) {
      reqCounts.set(rid, (reqCounts.get(rid) ?? 0) + 1);
    }
  }

  let bestCategory = "Review";
  let bestCatCount = -1;
  for (const [cat, count] of categoryCounts) {
    if (count > bestCatCount) {
      bestCatCount = count;
      bestCategory = cat;
    }
  }

  let bestReqId: string | undefined;
  let bestReqCount = -1;
  for (const [rid, count] of reqCounts) {
    if (count > bestReqCount) {
      bestReqCount = count;
      bestReqId = rid;
    }
  }

  if (bestReqId) {
    const req = reqById.get(bestReqId);
    if (req?.text) {
      const short =
        req.text.length > 40 ? `${req.text.slice(0, 37)}...` : req.text;
      return `${bestCategory}: ${short}`;
    }
  }
  return bestCategory;
}

type DayBucket = {
  day: number;
  question_ids: string[];
  minutes: number;
  isLearning: boolean;
};

function placeOnDay(bucket: DayBucket, q: ScoredQuestion): number {
  bucket.question_ids.push(q.id);
  bucket.minutes += q.minutes;
  return Math.max(0, bucket.minutes - DAY_MINUTE_CAP);
}

/**
 * Greedy fill: assign each question (score-desc) to the learning day with the
 * fewest minutes that still fits under the cap; ties → earlier day.
 * That front-loads high scorers while balancing minutes. If nothing fits under
 * the cap, use the least-loaded day and count overflow.
 */
function fillLearningDays(
  learning: DayBucket[],
  scored: ScoredQuestion[],
): number {
  let overflow = 0;
  if (learning.length === 0) return 0;

  for (const q of scored) {
    const fitting = learning.filter(
      (d) => d.minutes + q.minutes <= DAY_MINUTE_CAP,
    );
    const pool = fitting.length > 0 ? fitting : learning;
    let best = pool[0]!;
    for (const day of pool) {
      if (day.minutes < best.minutes) best = day;
      else if (day.minutes === best.minutes && day.day < best.day) best = day;
    }
    overflow += placeOnDay(best, q);
  }
  return overflow;
}

/**
 * Review / mock days revisit hardest + must questions with spacing.
 * Never leaves a day empty when at least one question exists.
 */
function fillReviewDays(
  review: DayBucket[],
  scored: ScoredQuestion[],
  reqById: Map<string, ScheduleRequirement>,
): void {
  if (review.length === 0 || scored.length === 0) return;

  const mustHard = [...scored].sort((a, b) => {
    const aMust = a.requirement_ids.some(
      (rid) => reqById.get(rid)?.priority === "must",
    )
      ? 1
      : 0;
    const bMust = b.requirement_ids.some(
      (rid) => reqById.get(rid)?.priority === "must",
    )
      ? 1
      : 0;
    if (bMust !== aMust) return bMust - aMust;
    if (b.difficulty !== a.difficulty) return b.difficulty - a.difficulty;
    return b.score - a.score;
  });

  for (let i = 0; i < review.length; i++) {
    const day = review[i]!;
    // Spaced index: stride through the must/hard list by review-day offset.
    const pick = mustHard[i % mustHard.length]!;
    // Also pull a second spaced item when the list is long enough and cap allows.
    const second = mustHard[(i * 2 + 1) % mustHard.length]!;
    placeOnDay(day, pick);
    if (
      second.id !== pick.id &&
      day.minutes + second.minutes <= DAY_MINUTE_CAP
    ) {
      placeOnDay(day, second);
    }
  }
}

/**
 * Ensure every must requirement is referenced by at least one scheduled question.
 * Injects a covering question onto the earliest day that can take it (or day 1).
 */
function ensureMustCoverage(
  days: DayBucket[],
  scored: ScoredQuestion[],
  requirements: ScheduleRequirement[],
): number {
  let overflow = 0;
  if (days.length === 0 || scored.length === 0) return 0;

  const scheduled = new Set<string>();
  for (const d of days) {
    for (const id of d.question_ids) scheduled.add(id);
  }

  const coveredMust = new Set<string>();
  for (const q of scored) {
    if (!scheduled.has(q.id)) continue;
    for (const rid of q.requirement_ids) {
      const r = requirements.find((x) => x.id === rid);
      if (r?.priority === "must") coveredMust.add(rid);
    }
  }

  const musts = requirements.filter((r) => r.priority === "must");
  for (const must of musts) {
    if (coveredMust.has(must.id)) continue;
    const cover = scored.find((q) => q.requirement_ids.includes(must.id));
    if (!cover) continue;

    let target = days[0]!;
    for (const d of days) {
      if (d.minutes + cover.minutes <= DAY_MINUTE_CAP) {
        target = d;
        break;
      }
    }
    if (!target.question_ids.includes(cover.id)) {
      overflow += placeOnDay(target, cover);
    }
    coveredMust.add(must.id);
  }
  return overflow;
}

/**
 * When there are more days than questions, learning fill may leave later
 * learning days empty — seed them with spaced review of earlier material.
 */
function fillEmptyDays(
  days: DayBucket[],
  scored: ScoredQuestion[],
): void {
  if (scored.length === 0) return;
  for (let i = 0; i < days.length; i++) {
    const day = days[i]!;
    if (day.question_ids.length > 0) continue;
    const pick = scored[i % scored.length]!;
    placeOnDay(day, pick);
  }
}

function toScheduleDay(
  bucket: DayBucket,
  isLast: boolean,
  byId: Map<string, ScoredQuestion>,
  reqById: Map<string, ScheduleRequirement>,
): ScheduleDay {
  const focus = isLast
    ? "Mock interview + weak spots"
    : dominantFocus(bucket.question_ids, byId, reqById);
  return {
    day: bucket.day,
    focus,
    question_ids: bucket.question_ids,
    minutes: Math.trunc(bucket.minutes),
  };
}

/**
 * Allocate a day-by-day schedule of exactly `daysAvailable` days (§8 / T14).
 * Pure — no LLM. Arithmetic and priority/difficulty scoring live in code.
 */
export function allocateSchedule(
  requirements: ScheduleRequirement[],
  questions: ScheduleQuestion[],
  daysAvailable: number,
): AllocateScheduleResult {
  const n = Math.trunc(daysAvailable);
  if (n <= 0) {
    return {
      schedule: { days_available: n, days: [] },
      notes: {},
    };
  }

  const reqById = new Map(requirements.map((r) => [r.id, r]));
  const scored: ScoredQuestion[] = questions.map((q) => ({
    ...q,
    score: scoreQuestion(q, questions, requirements),
    minutes: questionMinutes(q.difficulty),
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.id.localeCompare(b.id);
  });

  const byId = new Map(scored.map((q) => [q.id, q]));
  const learnCount = learningDayCount(n);
  const days: DayBucket[] = [];
  for (let d = 1; d <= n; d++) {
    days.push({
      day: d,
      question_ids: [],
      minutes: 0,
      isLearning: d <= learnCount,
    });
  }

  const learning = days.filter((d) => d.isLearning);
  const review = days.filter((d) => !d.isLearning);

  let overflowMinutes = fillLearningDays(learning, scored);
  fillReviewDays(review, scored, reqById);
  fillEmptyDays(days, scored);
  overflowMinutes += ensureMustCoverage(days, scored, requirements);

  // Recompute overflow after all placements (minutes may exceed cap).
  overflowMinutes = 0;
  for (const d of days) {
    if (d.minutes > DAY_MINUTE_CAP) {
      overflowMinutes += d.minutes - DAY_MINUTE_CAP;
    }
  }

  const scheduleDays = days.map((bucket, idx) =>
    toScheduleDay(bucket, idx === days.length - 1, byId, reqById),
  );

  const notes: AllocateScheduleNotes = {};
  if (overflowMinutes > 0) {
    notes.schedule_overflow = true;
    notes.overflow_minutes = overflowMinutes;
  }

  return {
    schedule: {
      days_available: n,
      days: scheduleDays,
    },
    notes,
  };
}

/** Mean question score for a day's question_ids (0 if empty). */
export function meanDayScore(
  questionIds: string[],
  scoreById: Map<string, number>,
): number {
  if (questionIds.length === 0) return 0;
  let sum = 0;
  for (const id of questionIds) {
    sum += scoreById.get(id) ?? 0;
  }
  return sum / questionIds.length;
}

export { DAY_MINUTE_CAP, learningDayCount };
