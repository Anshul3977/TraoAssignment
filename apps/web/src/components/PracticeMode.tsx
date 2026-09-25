"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiClientError,
  getPracticeNext,
  getPracticeStats,
  submitPracticeReview,
  type PracticeNextItem,
  type PracticeStats,
} from "@/lib/api";
import {
  applyPracticeKey,
  createPracticeSession,
  currentCard,
  sessionProgress,
  type Confidence,
  type PracticeSessionState,
  type SessionReview,
} from "@/lib/practice";

type PracticeModeProps = {
  kitId: string;
};

type View =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | { kind: "card"; session: PracticeSessionState; submitting: boolean }
  | {
      kind: "summary";
      reviews: SessionReview[];
      stats: PracticeStats | null;
    };

export function PracticeMode({ kitId }: PracticeModeProps) {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [stats, setStats] = useState<PracticeStats | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const sessionRef = useRef<PracticeSessionState | null>(null);
  const submittingRef = useRef(false);

  const loadSession = useCallback(async () => {
    setView({ kind: "loading" });
    setReviewError(null);
    submittingRef.current = false;
    try {
      const [{ items }, nextStats] = await Promise.all([
        getPracticeNext(kitId),
        getPracticeStats(kitId).catch(() => null),
      ]);
      if (nextStats) setStats(nextStats);
      const session = createPracticeSession(items);
      sessionRef.current = session;
      if (session.done) {
        setView({ kind: "empty" });
        return;
      }
      setView({ kind: "card", session, submitting: false });
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : "Could not load practice session.";
      setView({ kind: "error", message });
    }
  }, [kitId]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const finishSession = useCallback(
    async (reviews: SessionReview[]) => {
      let latestStats = stats;
      try {
        latestStats = await getPracticeStats(kitId);
        setStats(latestStats);
      } catch {
        // Keep last known stats for the grid if refresh fails.
      }
      setView({ kind: "summary", reviews, stats: latestStats });
    },
    [kitId, stats],
  );

  const submitConfidence = useCallback(
    async (confidence: Confidence) => {
      const session = sessionRef.current;
      if (!session || session.done || submittingRef.current) return;
      if (session.phase !== "back") return;
      const card = currentCard(session);
      if (!card) return;

      submittingRef.current = true;
      setReviewError(null);
      setView({ kind: "card", session, submitting: true });

      try {
        await submitPracticeReview(kitId, {
          flashcardId: card.flashcardId,
          confidence,
        });
      } catch (err) {
        submittingRef.current = false;
        const message =
          err instanceof ApiClientError
            ? err.message
            : "Could not save review. Try again.";
        setReviewError(message);
        setView({ kind: "card", session, submitting: false });
        return;
      }

      const { state: next } = applyPracticeKey(session, String(confidence));
      sessionRef.current = next;
      submittingRef.current = false;

      if (next.done) {
        await finishSession(next.reviews);
        return;
      }
      setView({ kind: "card", session: next, submitting: false });
    },
    [finishSession, kitId],
  );

  const onReveal = useCallback(() => {
    const session = sessionRef.current;
    if (!session || session.done || submittingRef.current) return;
    const { state: next, action } = applyPracticeKey(session, " ");
    if (action.type !== "reveal") return;
    sessionRef.current = next;
    setView({ kind: "card", session: next, submitting: false });
  }, []);

  useEffect(() => {
    if (view.kind !== "card" || view.submitting) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      const session = sessionRef.current;
      if (!session || session.done) return;

      const { action } = applyPracticeKey(session, e.key);
      if (action.type === "reveal") {
        e.preventDefault();
        onReveal();
        return;
      }
      if (action.type === "review") {
        e.preventDefault();
        void submitConfidence(action.confidence);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view, onReveal, submitConfidence]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Practice</h1>
          <Link
            href={`/kits/${encodeURIComponent(kitId)}`}
            className="text-sm text-zinc-600 underline hover:text-zinc-900"
          >
            Back to builder
          </Link>
        </div>
        <p className="text-sm text-zinc-600">
          One card at a time. Space or Enter reveals the answer; keys 1–5 rate
          confidence. Order comes from the API next-session queue.
        </p>
      </header>

      {view.kind === "loading" ? (
        <p className="text-sm text-zinc-500" role="status">
          Loading session…
        </p>
      ) : null}

      {view.kind === "error" ? (
        <div
          className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
          role="alert"
        >
          <p>{view.message}</p>
          <button
            type="button"
            onClick={() => void loadSession()}
            className="mt-3 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
          >
            Retry
          </button>
        </div>
      ) : null}

      {view.kind === "empty" ? (
        <div
          className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-700"
          data-testid="practice-empty"
        >
          <p>No flashcards on this kit yet. Add some in the builder, then return.</p>
          <Link
            href={`/kits/${encodeURIComponent(kitId)}`}
            className="mt-3 inline-block text-sm font-medium text-zinc-900 underline"
          >
            Open builder
          </Link>
        </div>
      ) : null}

      {view.kind === "card" ? (
        <CardView
          session={view.session}
          submitting={view.submitting}
          reviewError={reviewError}
          onReveal={onReveal}
          onConfidence={(c) => void submitConfidence(c)}
        />
      ) : null}

      {view.kind === "summary" ? (
        <SummaryView
          reviews={view.reviews}
          stats={view.stats}
          onAgain={() => void loadSession()}
          kitId={kitId}
        />
      ) : null}
    </div>
  );
}

function CardView({
  session,
  submitting,
  reviewError,
  onReveal,
  onConfidence,
}: {
  session: PracticeSessionState;
  submitting: boolean;
  reviewError: string | null;
  onReveal: () => void;
  onConfidence: (c: Confidence) => void;
}) {
  const card = currentCard(session);
  const progress = sessionProgress(session.reviews.length, session.items.length);
  if (!card) return null;

  return (
    <div className="flex flex-col gap-4" data-testid="practice-card">
      <ProgressBar progress={progress} />

      <div
        className="rounded-lg border border-zinc-200 bg-white p-6"
        aria-live="polite"
      >
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Front
        </p>
        <p
          className="mt-2 text-lg leading-relaxed text-zinc-900"
          data-testid="practice-front"
        >
          {card.front}
        </p>

        {session.phase === "back" ? (
          <div className="mt-6 border-t border-zinc-100 pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Back
            </p>
            <p
              className="mt-2 text-base leading-relaxed text-zinc-800"
              data-testid="practice-back"
            >
              {card.back}
            </p>
          </div>
        ) : (
          <p className="mt-6 text-sm text-zinc-500" data-testid="practice-hidden">
            Answer hidden — press Space or Enter to reveal.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {session.phase === "front" ? (
          <button
            type="button"
            onClick={onReveal}
            disabled={submitting}
            className="rounded-md border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            data-testid="practice-reveal"
          >
            Reveal
          </button>
        ) : (
          <div
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label="Confidence 1 to 5"
            data-testid="practice-confidence"
          >
            <span className="text-sm text-zinc-600">Confidence:</span>
            {([1, 2, 3, 4, 5] as Confidence[]).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onConfidence(n)}
                disabled={submitting}
                className="min-w-10 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
                data-testid={`practice-confidence-${n}`}
                aria-label={`Confidence ${n}`}
              >
                {n}
              </button>
            ))}
          </div>
        )}
        {submitting ? (
          <span className="text-sm text-zinc-500" role="status">
            Saving…
          </span>
        ) : null}
      </div>

      {reviewError ? (
        <p className="text-sm text-amber-800" role="alert">
          {reviewError}
        </p>
      ) : null}

      <p className="text-xs text-zinc-500">
        Keyboard: Space / Enter reveal · 1–5 rate after reveal
      </p>
    </div>
  );
}

function ProgressBar({
  progress,
}: {
  progress: ReturnType<typeof sessionProgress>;
}) {
  const pct = Math.round(progress.ratio * 100);
  return (
    <div data-testid="practice-progress">
      <div className="mb-1 flex justify-between text-xs text-zinc-600">
        <span>Session progress</span>
        <span>{progress.label}</span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-zinc-200"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.reviewed}
        aria-label="Session progress"
      >
        <div
          className="h-full rounded-full bg-zinc-800 transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function SummaryView({
  reviews,
  stats,
  onAgain,
  kitId,
}: {
  reviews: SessionReview[];
  stats: PracticeStats | null;
  onAgain: () => void;
  kitId: string;
}) {
  return (
    <div className="flex flex-col gap-6" data-testid="practice-summary">
      <section className="rounded-lg border border-zinc-200 bg-white p-6">
        <h2 className="text-lg font-semibold tracking-tight">Session summary</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Reviewed {reviews.length} card{reviews.length === 1 ? "" : "s"} this
          session.
        </p>
        <ul className="mt-4 space-y-2 text-sm">
          {reviews.map((r) => (
            <li
              key={`${r.flashcardId}-${r.confidence}`}
              className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-100 pb-2"
            >
              <span className="text-zinc-800">{r.front}</span>
              <span className="font-mono text-xs text-zinc-500">
                confidence {r.confidence}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {stats ? <CoverageGrid stats={stats} /> : null}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onAgain}
          className="rounded-md border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          data-testid="practice-again"
        >
          Next session
        </button>
        <Link
          href={`/kits/${encodeURIComponent(kitId)}`}
          className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
        >
          Back to builder
        </Link>
      </div>
    </div>
  );
}

function CoverageGrid({ stats }: { stats: PracticeStats }) {
  return (
    <section
      className="rounded-lg border border-zinc-200 bg-white p-6"
      aria-labelledby="coverage-heading"
      data-testid="practice-coverage"
    >
      <h2
        id="coverage-heading"
        className="text-lg font-semibold tracking-tight"
      >
        Requirement coverage
      </h2>
      <p className="mt-1 text-sm text-zinc-600">
        {stats.totals.covered} covered · {stats.totals.notCovered} not covered ·{" "}
        {stats.totals.reviewed} / {stats.totals.cards} cards reviewed
      </p>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {stats.requirements.map((r) => (
          <li
            key={r.id}
            className={`rounded-md border px-3 py-2 text-sm ${
              r.covered
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-zinc-200 bg-zinc-50 text-zinc-700"
            }`}
            data-testid={`coverage-${r.id}`}
            data-covered={r.covered ? "true" : "false"}
          >
            <span className="font-mono text-xs opacity-70">{r.id}</span>
            <span className="ml-2 text-xs uppercase tracking-wide opacity-70">
              {r.priority}
            </span>
            <p className="mt-0.5">{r.text}</p>
            <p className="mt-1 text-xs font-medium">
              {r.covered ? "Covered" : "Not covered"}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Exported for tests that need a sample queue shape. */
export type { PracticeNextItem };
