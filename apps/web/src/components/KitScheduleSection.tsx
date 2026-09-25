"use client";

import { useId, useMemo, useState } from "react";
import type { KitQuestion, KitSchedule } from "@/lib/api";
import { scheduleSummary } from "@/lib/kit-builder";
import {
  buildScheduleDayCards,
  interviewDateFromCreatedAt,
  toLocalDateKey,
} from "@/lib/schedule-views";

type KitScheduleSectionProps = {
  schedule: KitSchedule;
  questions: readonly KitQuestion[];
  /** Kit createdAt — used to derive interview date and the Today marker. */
  createdAt: string;
  regenerating: boolean;
  onRequestRegenerate: () => void;
};

export function KitScheduleSection({
  schedule,
  questions,
  createdAt,
  regenerating,
  onRequestRegenerate,
}: KitScheduleSectionProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const titleId = useId();
  const summary = scheduleSummary(schedule);
  const cards = useMemo(
    () => buildScheduleDayCards(schedule, questions, createdAt),
    [schedule, questions, createdAt],
  );
  const interviewKey = toLocalDateKey(
    interviewDateFromCreatedAt(createdAt, schedule.days_available),
  );

  return (
    <section
      aria-labelledby={titleId}
      className="rounded-lg border border-zinc-200 bg-white p-6"
      data-testid="schedule-section"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id={titleId} className="text-lg font-semibold tracking-tight">
          Schedule
        </h2>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={regenerating}
          className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          data-testid="schedule-regen-open"
        >
          {regenerating ? "Regenerating…" : "Regenerate schedule"}
        </button>
      </div>

      <p className="text-sm text-zinc-600" data-testid="schedule-summary">
        {summary.dayCount} day{summary.dayCount === 1 ? "" : "s"} ·{" "}
        {summary.daysAvailable} available · {summary.totalMinutes} minutes
        total
      </p>
      <p className="mt-1 text-sm text-zinc-600" data-testid="interview-date">
        Interview date:{" "}
        <time dateTime={interviewKey}>{interviewKey}</time>
        <span className="text-zinc-500">
          {" "}
          (from kit created date + {schedule.days_available} prep day
          {schedule.days_available === 1 ? "" : "s"})
        </span>
      </p>
      <p className="mt-1 text-xs text-zinc-500">
        Regenerating reallocates days from current questions. Brief, role,
        questions, and flashcards are left unchanged.
      </p>

      {cards.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">No schedule days yet.</p>
      ) : (
        <ul className="mt-4 grid gap-3" data-testid="schedule-days">
          {cards.map((card) => (
            <li
              key={card.day}
              className={`rounded-lg border px-4 py-3 text-sm ${
                card.isToday
                  ? "border-sky-400 bg-sky-50 ring-1 ring-sky-300"
                  : "border-zinc-200 bg-zinc-50/50"
              }`}
              data-testid={`schedule-day-${card.day}`}
              data-today={card.isToday ? "true" : "false"}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-zinc-900">
                    Day {card.day}
                  </span>
                  {card.isToday ? (
                    <span
                      className="rounded-full bg-sky-600 px-2 py-0.5 text-xs font-medium text-white"
                      data-testid={`schedule-today-${card.day}`}
                    >
                      Today
                    </span>
                  ) : null}
                  <span className="text-xs text-zinc-500">
                    <time dateTime={card.date}>{card.date}</time>
                  </span>
                </div>
                <span className="text-xs text-zinc-500">{card.minutes} min</span>
              </div>
              {card.focus ? (
                <p className="mt-1 text-zinc-700" data-testid={`schedule-focus-${card.day}`}>
                  {card.focus}
                </p>
              ) : null}
              {card.questions.length === 0 ? (
                <p className="mt-2 text-xs text-zinc-500">No questions</p>
              ) : (
                <ul
                  className="mt-2 space-y-1"
                  data-testid={`schedule-questions-${card.day}`}
                >
                  {card.questions.map((q) => (
                    <li
                      key={q.id}
                      className="flex flex-wrap items-baseline gap-2 text-xs text-zinc-700"
                      data-testid={`schedule-q-${card.day}-${q.id}`}
                    >
                      <a
                        href={`#question-${q.id}`}
                        className="font-mono text-sky-800 underline hover:text-sky-950"
                      >
                        {q.id}
                      </a>
                      <span className="text-zinc-800">{q.prompt}</span>
                      {q.category ? (
                        <span className="text-zinc-400">{q.category}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {confirmOpen ? (
        <ScheduleRegenConfirmDialog
          busy={regenerating}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            onRequestRegenerate();
          }}
        />
      ) : null}
    </section>
  );
}

function ScheduleRegenConfirmDialog({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      data-testid="schedule-regen-backdrop"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-5 shadow-lg"
        data-testid="schedule-regen-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={titleId} className="text-base font-semibold text-zinc-900">
          Regenerate schedule?
        </h3>
        <p className="mt-2 text-sm text-zinc-600">
          Day focus and question assignments will be reallocated from the
          current question set. Pending text edits will be saved first. Brief,
          questions, and flashcards will not be overwritten.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            data-testid="schedule-regen-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            data-testid="schedule-regen-confirm"
          >
            Regenerate
          </button>
        </div>
      </div>
    </div>
  );
}
