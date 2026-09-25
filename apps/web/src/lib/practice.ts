/**
 * Pure helpers for practice mode (T24).
 * Session order comes from GET /kits/:id/practice/next — do not re-sort client-side.
 */

import type { PracticeNextItem, PracticeRequirementStat } from "./api";

export type Confidence = 1 | 2 | 3 | 4 | 5;

export type SessionReview = {
  flashcardId: string;
  confidence: Confidence;
  front: string;
};

/** Card phase: front (hidden answer) → back (revealed) → advance after review. */
export type PracticeCardPhase = "front" | "back";

export type PracticeSessionState = {
  items: PracticeNextItem[];
  index: number;
  phase: PracticeCardPhase;
  reviews: SessionReview[];
  done: boolean;
};

export type PracticeKeyAction =
  | { type: "none" }
  | { type: "reveal" }
  | { type: "review"; confidence: Confidence };

export function createPracticeSession(
  items: PracticeNextItem[],
): PracticeSessionState {
  return {
    items,
    index: 0,
    phase: "front",
    reviews: [],
    done: items.length === 0,
  };
}

export function currentCard(
  state: PracticeSessionState,
): PracticeNextItem | null {
  if (state.done || state.index >= state.items.length) return null;
  return state.items[state.index] ?? null;
}

/** Progress through the current session queue (0…total). */
export function sessionProgress(
  reviewedCount: number,
  total: number,
): { reviewed: number; total: number; ratio: number; label: string } {
  const safeTotal = Math.max(0, total);
  const reviewed = Math.min(Math.max(0, reviewedCount), safeTotal);
  const ratio = safeTotal === 0 ? 0 : reviewed / safeTotal;
  return {
    reviewed,
    total: safeTotal,
    ratio,
    label: `${reviewed} / ${safeTotal}`,
  };
}

export function isRevealKey(key: string): boolean {
  return key === " " || key === "Enter";
}

export function parseConfidenceKey(key: string): Confidence | null {
  if (key === "1" || key === "2" || key === "3" || key === "4" || key === "5") {
    return Number(key) as Confidence;
  }
  return null;
}

/**
 * Keyboard mapping for a single-card practice turn.
 * Space/Enter reveal; 1–5 only apply after reveal.
 */
export function practiceKeyAction(
  phase: PracticeCardPhase,
  key: string,
): PracticeKeyAction {
  if (isRevealKey(key)) {
    if (phase === "front") return { type: "reveal" };
    return { type: "none" };
  }
  const confidence = parseConfidenceKey(key);
  if (confidence !== null && phase === "back") {
    return { type: "review", confidence };
  }
  return { type: "none" };
}

/**
 * Apply a keyboard action to session state (pure; does not call the API).
 * Review advances to the next card or marks the session done.
 */
export function applyPracticeKey(
  state: PracticeSessionState,
  key: string,
): { state: PracticeSessionState; action: PracticeKeyAction } {
  if (state.done) {
    return { state, action: { type: "none" } };
  }
  const card = currentCard(state);
  if (!card) {
    return {
      state: { ...state, done: true },
      action: { type: "none" },
    };
  }

  const action = practiceKeyAction(state.phase, key);
  if (action.type === "reveal") {
    return {
      state: { ...state, phase: "back" },
      action,
    };
  }
  if (action.type === "review") {
    const reviews: SessionReview[] = [
      ...state.reviews,
      {
        flashcardId: card.flashcardId,
        confidence: action.confidence,
        front: card.front,
      },
    ];
    const nextIndex = state.index + 1;
    const done = nextIndex >= state.items.length;
    return {
      state: {
        ...state,
        reviews,
        index: done ? state.index : nextIndex,
        phase: "front",
        done,
      },
      action,
    };
  }
  return { state, action };
}

/**
 * Simulate a full keyboard-only session: for each card, reveal then rate.
 * `confidences[i]` is the rating for card i (defaults to 3).
 */
export function runKeyboardSession(
  items: PracticeNextItem[],
  confidences: Confidence[] = [],
): PracticeSessionState {
  let state = createPracticeSession(items);
  let i = 0;
  while (!state.done) {
    ({ state } = applyPracticeKey(state, " "));
    const confidence = confidences[i] ?? 3;
    ({ state } = applyPracticeKey(state, String(confidence)));
    i += 1;
    if (i > items.length + 2) break; // safety
  }
  return state;
}

export function coveredRequirements(
  requirements: PracticeRequirementStat[],
): PracticeRequirementStat[] {
  return requirements.filter((r) => r.covered);
}

export function notCoveredRequirements(
  requirements: PracticeRequirementStat[],
): PracticeRequirementStat[] {
  return requirements.filter((r) => !r.covered);
}
