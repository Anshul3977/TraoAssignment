import { describe, expect, it } from "vitest";
import type { GenerationJob } from "./api";
import {
  extractSources,
  formatElapsed,
  isJobTerminal,
  jobElapsedMs,
  shouldPollJob,
  stepMarker,
  toStepDisplay,
} from "./job-view";

function job(partial: Partial<GenerationJob> & Pick<GenerationJob, "status">): GenerationJob {
  return {
    id: "job1",
    userId: "u1",
    kitId: null,
    steps: [],
    error: null,
    input: { jd: "x", company_url: "https://example.com", days: 5 },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:01:30.000Z",
    ...partial,
  };
}

describe("shouldPollJob / isJobTerminal", () => {
  it("polls queued and running only", () => {
    expect(shouldPollJob("queued")).toBe(true);
    expect(shouldPollJob("running")).toBe(true);
    expect(shouldPollJob("done")).toBe(false);
    expect(shouldPollJob("failed")).toBe(false);
    expect(isJobTerminal("done")).toBe(true);
    expect(isJobTerminal("failed")).toBe(true);
  });
});

describe("toStepDisplay — UI states from mocked payloads", () => {
  it("maps running → spinner", () => {
    const d = toStepDisplay({
      step: "crawl",
      status: "running",
      detail: "https://example.com",
    });
    expect(d.marker).toBe("spinner");
    expect(d.label).toBe("Running");
    expect(stepMarker("running")).toBe("spinner");
  });

  it("maps done → check", () => {
    const d = toStepDisplay({
      step: "extract",
      status: "done",
      detail: "4 grounded requirement(s)",
    });
    expect(d.marker).toBe("check");
    expect(d.label).toBe("Done");
  });

  it("maps skipped → skip with reason detail", () => {
    const d = toStepDisplay({
      step: "search_discussion",
      status: "skipped",
      detail: "no discussion found",
    });
    expect(d.marker).toBe("skip");
    expect(d.label).toBe("Skipped");
    expect(d.detail).toBe("no discussion found");
  });

  it("maps failed → fail", () => {
    const d = toStepDisplay({
      step: "questions",
      status: "failed",
      detail: "LLM unavailable",
    });
    expect(d.marker).toBe("fail");
    expect(d.label).toBe("Failed");
  });
});

describe("extractSources", () => {
  it("splits found vs skipped from a running/partial job", () => {
    const sources = extractSources(
      job({
        status: "running",
        steps: [
          {
            step: "extract",
            status: "done",
            detail: "3 grounded requirement(s)",
          },
          {
            step: "crawl",
            status: "done",
            detail: "about=2 hiring=1",
          },
          {
            step: "search_discussion",
            status: "skipped",
            detail: "no discussion found",
          },
          { step: "brief", status: "running" },
        ],
      }),
    );
    expect(sources.filter((s) => s.kind === "found")).toEqual([
      {
        kind: "found",
        step: "extract",
        detail: "3 grounded requirement(s)",
      },
      { kind: "found", step: "crawl", detail: "about=2 hiring=1" },
    ]);
    expect(sources.filter((s) => s.kind === "skipped")).toEqual([
      {
        kind: "skipped",
        step: "search_discussion",
        detail: "no discussion found",
      },
    ]);
  });

  it("includes failed job error timeline steps as fail markers", () => {
    const failed = job({
      status: "failed",
      error: { code: "LLM_UNAVAILABLE", message: "No provider" },
      steps: [
        { step: "extract", status: "done", detail: "2 grounded requirement(s)" },
        { step: "questions", status: "failed", detail: "No provider" },
      ],
    });
    expect(toStepDisplay(failed.steps[1]!).marker).toBe("fail");
    expect(extractSources(failed).some((s) => s.kind === "found")).toBe(true);
  });
});

describe("elapsed", () => {
  it("uses updatedAt when terminal", () => {
    const ms = jobElapsedMs(
      job({
        status: "done",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:01:32.000Z",
      }),
    );
    expect(ms).toBe(92_000);
    expect(formatElapsed(ms)).toBe("1m 32s");
  });

  it("uses now when still running", () => {
    const ms = jobElapsedMs(
      job({
        status: "running",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:10.000Z",
      }),
      Date.parse("2026-01-01T00:00:45.000Z"),
    );
    expect(ms).toBe(45_000);
    expect(formatElapsed(ms)).toBe("45s");
  });
});
