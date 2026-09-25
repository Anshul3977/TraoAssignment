/**
 * Pure helpers for the job progress UI (T22b).
 * Maps docs/API.md GenerationJob payloads → display state.
 */

import type { GenerationJob } from "./api";

export type StepStatus = "running" | "done" | "skipped" | "failed" | "queued" | "unknown";

export type StepDisplay = {
  step: string;
  status: StepStatus;
  detail?: string;
  /** Icon / label cue for the timeline. */
  marker: "spinner" | "check" | "skip" | "fail" | "pending";
  label: string;
};

export type SourceEntry = {
  kind: "found" | "skipped";
  step: string;
  detail: string;
};

const TERMINAL: ReadonlySet<GenerationJob["status"]> = new Set([
  "done",
  "failed",
]);

export function isJobTerminal(status: GenerationJob["status"]): boolean {
  return TERMINAL.has(status);
}

/** Poll while queued/running; stop when done/failed. */
export function shouldPollJob(status: GenerationJob["status"]): boolean {
  return status === "queued" || status === "running";
}

export function normalizeStepStatus(raw: string): StepStatus {
  const s = raw.toLowerCase();
  if (
    s === "running" ||
    s === "done" ||
    s === "skipped" ||
    s === "failed" ||
    s === "queued"
  ) {
    return s;
  }
  return "unknown";
}

export function stepMarker(status: StepStatus): StepDisplay["marker"] {
  switch (status) {
    case "running":
      return "spinner";
    case "done":
      return "check";
    case "skipped":
      return "skip";
    case "failed":
      return "fail";
    default:
      return "pending";
  }
}

export function stepLabel(status: StepStatus): string {
  switch (status) {
    case "running":
      return "Running";
    case "done":
      return "Done";
    case "skipped":
      return "Skipped";
    case "failed":
      return "Failed";
    case "queued":
      return "Queued";
    default:
      return status;
  }
}

export function toStepDisplay(
  step: GenerationJob["steps"][number],
): StepDisplay {
  const status = normalizeStepStatus(step.status);
  return {
    step: step.step,
    status,
    detail: step.detail,
    marker: stepMarker(status),
    label: stepLabel(status),
  };
}

/**
 * Sources found/skipped from step timeline:
 * - skipped steps → skipped (detail = reason)
 * - done crawl / search_discussion with detail → found
 */
export function extractSources(job: GenerationJob): SourceEntry[] {
  const out: SourceEntry[] = [];
  for (const raw of job.steps) {
    const status = normalizeStepStatus(raw.status);
    const detail = (raw.detail ?? "").trim();
    if (status === "skipped") {
      out.push({
        kind: "skipped",
        step: raw.step,
        detail: detail || "skipped",
      });
      continue;
    }
    if (
      status === "done" &&
      detail &&
      (raw.step === "crawl" ||
        raw.step === "search_discussion" ||
        raw.step === "extract")
    ) {
      out.push({ kind: "found", step: raw.step, detail });
    }
  }
  return out;
}

/** Elapsed ms from createdAt to updatedAt (terminal) or `now` (in flight). */
export function jobElapsedMs(
  job: Pick<GenerationJob, "createdAt" | "updatedAt" | "status">,
  nowMs: number = Date.now(),
): number {
  const start = Date.parse(job.createdAt);
  if (Number.isNaN(start)) return 0;
  const end = isJobTerminal(job.status)
    ? Date.parse(job.updatedAt)
    : nowMs;
  const endSafe = Number.isNaN(end) ? nowMs : end;
  return Math.max(0, endSafe - start);
}

/** Human-readable elapsed, e.g. "1m 32s", "45s". */
export function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m <= 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

export function jobStatusLabel(status: GenerationJob["status"]): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "done":
      return "Done";
    case "failed":
      return "Failed";
  }
}
