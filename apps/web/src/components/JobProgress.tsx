"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ApiClientError,
  getJob,
  retryJob,
  type GenerationJob,
} from "@/lib/api";
import {
  extractSources,
  formatElapsed,
  isJobTerminal,
  jobElapsedMs,
  jobStatusLabel,
  shouldPollJob,
  toStepDisplay,
} from "@/lib/job-view";

const POLL_MS = 2000;

type JobProgressProps = {
  jobId: string;
  /** Optional seed from server; client re-fetches immediately. */
  initialJob?: GenerationJob | null;
};

export function JobProgress({ jobId, initialJob = null }: JobProgressProps) {
  const [job, setJob] = useState<GenerationJob | null>(initialJob);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const { job: next } = await getJob(jobId);
      setJob(next);
      setError(null);
      return next;
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : "Could not load job progress.";
      setError(message);
      return null;
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!job || !shouldPollJob(job.status)) return;
    const id = window.setInterval(() => {
      void load();
      setNowMs(Date.now());
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [job, load]);

  useEffect(() => {
    if (!job || isJobTerminal(job.status)) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [job]);

  async function onRetry() {
    setRetrying(true);
    setError(null);
    try {
      const { job: next } = await retryJob(jobId);
      setJob(next);
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : "Retry failed. Try again.";
      setError(message);
    } finally {
      setRetrying(false);
    }
  }

  if (!job && !error) {
    return (
      <p className="text-sm text-zinc-600" role="status">
        Loading job…
      </p>
    );
  }

  if (!job) {
    return (
      <p className="text-sm text-red-600" role="alert">
        {error}
      </p>
    );
  }

  const steps = job.steps.map(toStepDisplay);
  const sources = extractSources(job);
  const found = sources.filter((s) => s.kind === "found");
  const skipped = sources.filter((s) => s.kind === "skipped");
  const elapsed = formatElapsed(jobElapsedMs(job, nowMs));
  const safeToLeave = shouldPollJob(job.status) || job.status === "queued";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Job progress
          </h1>
          <span
            className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium uppercase tracking-wide text-zinc-700"
            data-testid="job-status"
          >
            {jobStatusLabel(job.status)}
          </span>
        </div>
        <p className="text-sm text-zinc-600">
          Elapsed: <span data-testid="job-elapsed">{elapsed}</span>
          {safeToLeave ? (
            <>
              {" "}
              · Safe to leave this page and return — progress is saved on the
              server.
            </>
          ) : null}
        </p>
        {job.status === "done" && job.kitId ? (
          <p className="text-sm text-emerald-800" data-testid="job-kit-ready">
            Kit ready (id {job.kitId}). Open it from the dashboard once the
            builder is available.
          </p>
        ) : null}
      </header>

      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {job.status === "failed" ? (
        <div
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-950"
          role="alert"
          data-testid="job-failed"
        >
          <p className="font-medium">
            {job.error?.code ?? "FAILED"}:{" "}
            {job.error?.message ?? "Generation failed."}
          </p>
          <button
            type="button"
            onClick={() => void onRetry()}
            disabled={retrying}
            className="mt-3 rounded-md bg-zinc-900 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            {retrying ? "Retrying…" : "Retry job"}
          </button>
        </div>
      ) : null}

      <section aria-labelledby="timeline-heading">
        <h2 id="timeline-heading" className="text-sm font-semibold text-zinc-800">
          Steps
        </h2>
        {steps.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            {job.status === "queued"
              ? "Waiting in queue…"
              : "No steps recorded yet."}
          </p>
        ) : (
          <ol className="mt-3 space-y-2" data-testid="job-timeline">
            {steps.map((s, i) => (
              <li
                key={`${s.step}-${i}`}
                className="flex items-start gap-3 rounded-md border border-zinc-200 bg-white px-3 py-2.5 text-sm"
                data-status={s.status}
              >
                <StepMarker marker={s.marker} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium text-zinc-900">{s.step}</span>
                    <span className="text-xs text-zinc-500">{s.label}</span>
                  </div>
                  {s.detail ? (
                    <p className="mt-0.5 break-words text-xs text-zinc-600">
                      {s.status === "skipped" ? `Reason: ${s.detail}` : s.detail}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="sources-heading">
        <h2 id="sources-heading" className="text-sm font-semibold text-zinc-800">
          Sources
        </h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Found
            </h3>
            {found.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500">None yet.</p>
            ) : (
              <ul className="mt-2 space-y-1.5 text-sm text-zinc-700">
                {found.map((s, i) => (
                  <li key={`f-${s.step}-${i}`}>
                    <span className="font-medium">{s.step}</span>
                    <span className="text-zinc-500"> — {s.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Skipped
            </h3>
            {skipped.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500">None.</p>
            ) : (
              <ul className="mt-2 space-y-1.5 text-sm text-zinc-700">
                {skipped.map((s, i) => (
                  <li key={`s-${s.step}-${i}`}>
                    <span className="font-medium">{s.step}</span>
                    <span className="text-zinc-500"> — {s.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <p className="text-sm text-zinc-600">
        <Link href="/" className="underline hover:text-zinc-900">
          Back to dashboard
        </Link>
        {" · "}
        <Link href="/kits/new" className="underline hover:text-zinc-900">
          Create another
        </Link>
      </p>
    </div>
  );
}

function StepMarker({
  marker,
}: {
  marker: ReturnType<typeof toStepDisplay>["marker"];
}) {
  if (marker === "spinner") {
    return (
      <span
        className="mt-0.5 inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-800"
        aria-label="Running"
        role="status"
      />
    );
  }
  if (marker === "check") {
    return (
      <span className="mt-0.5 text-emerald-600" aria-label="Done">
        ✓
      </span>
    );
  }
  if (marker === "skip") {
    return (
      <span className="mt-0.5 text-amber-600" aria-label="Skipped">
        –
      </span>
    );
  }
  if (marker === "fail") {
    return (
      <span className="mt-0.5 text-red-600" aria-label="Failed">
        ✕
      </span>
    );
  }
  return (
    <span className="mt-0.5 text-zinc-400" aria-label="Pending">
      ·
    </span>
  );
}
