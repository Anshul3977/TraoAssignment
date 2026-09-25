/**
 * Leitner-style practice scheduling (§7 / T20).
 *
 * Box update on review:
 *   confidence ≤ 2 → box 1
 *   confidence === 3 → box 2
 *   confidence ≥ 4 → min(5, box + 1)  (unseen cards start from box 1)
 *
 * Next-session order for seen cards: box↑, lastConfidence↑, lastSeenAt↑.
 * Never-seen cards are interleaved early (one before each sorted seen card
 * until the never-seen pool is exhausted).
 */

export type PracticeCardState = {
  flashcardId: string;
  box: number;
  lastConfidence?: number | null;
  lastSeenAt?: Date | string | null;
};

export function nextLeitnerBox(
  currentBox: number | undefined | null,
  confidence: number,
): number {
  if (confidence <= 2) return 1;
  if (confidence === 3) return 2;
  const prev = currentBox && currentBox >= 1 ? currentBox : 1;
  return Math.min(5, prev + 1);
}

function toTime(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

function compareSeen(a: PracticeCardState, b: PracticeCardState): number {
  if (a.box !== b.box) return a.box - b.box;
  const ca = a.lastConfidence ?? 0;
  const cb = b.lastConfidence ?? 0;
  if (ca !== cb) return ca - cb;
  return toTime(a.lastSeenAt) - toTime(b.lastSeenAt);
}

function isNeverSeen(state: PracticeCardState | undefined): boolean {
  return !state || state.lastSeenAt == null;
}

/**
 * Returns flashcard ids in next-session order.
 * `flashcardIds` is the kit's current card set (stable kit order used as a
 * tie-break for never-seen / equal keys).
 */
export function orderNextSession(
  flashcardIds: readonly string[],
  states: ReadonlyMap<string, PracticeCardState>,
): string[] {
  const neverSeen: string[] = [];
  const seen: PracticeCardState[] = [];

  for (const id of flashcardIds) {
    const state = states.get(id);
    if (isNeverSeen(state)) {
      neverSeen.push(id);
    } else {
      seen.push({
        flashcardId: id,
        box: state!.box,
        lastConfidence: state!.lastConfidence ?? null,
        lastSeenAt: state!.lastSeenAt ?? null,
      });
    }
  }

  seen.sort(compareSeen);

  const result: string[] = [];
  let ni = 0;
  for (const card of seen) {
    if (ni < neverSeen.length) {
      result.push(neverSeen[ni++]!);
    }
    result.push(card.flashcardId);
  }
  while (ni < neverSeen.length) {
    result.push(neverSeen[ni++]!);
  }
  return result;
}

export type RequirementCoverage = {
  id: string;
  text: string;
  priority: "must" | "nice";
  covered: boolean;
};

/**
 * A requirement is covered when ≥1 of its flashcards has been reviewed.
 * Requirements with no flashcards are not covered.
 */
export function computeRequirementStats(
  requirements: readonly {
    id: string;
    text: string;
    priority: "must" | "nice";
  }[],
  flashcards: readonly { id: string; requirement_ids: string[] }[],
  reviewedIds: ReadonlySet<string>,
): {
  requirements: RequirementCoverage[];
  totals: {
    covered: number;
    notCovered: number;
    cards: number;
    reviewed: number;
  };
} {
  const cardsByReq = new Map<string, string[]>();
  for (const f of flashcards) {
    for (const rid of f.requirement_ids) {
      const list = cardsByReq.get(rid) ?? [];
      list.push(f.id);
      cardsByReq.set(rid, list);
    }
  }

  const reqStats: RequirementCoverage[] = requirements.map((r) => {
    const linked = cardsByReq.get(r.id) ?? [];
    const covered =
      linked.length > 0 && linked.some((fid) => reviewedIds.has(fid));
    return {
      id: r.id,
      text: r.text,
      priority: r.priority,
      covered,
    };
  });

  const covered = reqStats.filter((r) => r.covered).length;
  return {
    requirements: reqStats,
    totals: {
      covered,
      notCovered: reqStats.length - covered,
      cards: flashcards.length,
      reviewed: reviewedIds.size,
    },
  };
}
