"use client";

import { useId, useState } from "react";
import type { KitSchedule } from "@/lib/api";
import { scheduleSummary } from "@/lib/kit-builder";

type KitScheduleSectionProps = {
  schedule: KitSchedule;
  regenerating: boolean;
  onRequestRegenerate: () => void;
};

export function KitScheduleSection({
  schedule,
  regenerating,
  onRequestRegenerate,
}: KitScheduleSectionProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const titleId = useId();
  const summary = scheduleSummary(schedule);
  const days = schedule.days ?? [];

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
      <p className="mt-1 text-xs text-zinc-500">
        Regenerating reallocates days from current questions. Brief, role,
        questions, and flashcards are left unchanged.
      </p>

      {days.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">No schedule days yet.</p>
      ) : (
        <ul className="mt-4 space-y-2" data-testid="schedule-days">
          {days.map((d) => (
            <li
              key={d.day}
              className="rounded-md border border-zinc-200 bg-zinc-50/50 px-3 py-2 text-sm"
              data-testid={`schedule-day-${d.day}`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-zinc-900">
                  Day {d.day}
                  {d.focus ? (
                    <span className="font-normal text-zinc-600">
                      {" "}
                      — {d.focus}
                    </span>
                  ) : null}
                </span>
                <span className="text-xs text-zinc-500">{d.minutes} min</span>
              </div>
              <p className="mt-1 font-mono text-xs text-zinc-500">
                {d.question_ids.length > 0
                  ? d.question_ids.join(", ")
                  : "No questions"}
              </p>
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
