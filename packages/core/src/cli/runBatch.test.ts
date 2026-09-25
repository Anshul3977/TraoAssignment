import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PipelineError } from "../pipeline.js";
import { BatchOutputSchema, type Kit } from "../schema/index.js";
import {
  formatBatchSummary,
  runBatch,
  type BatchCase,
  type CaseRunner,
} from "./runBatch.js";

function minimalKit(days: number): Kit {
  return {
    source: {
      company: "Acme",
      company_url: "http://localhost:8099/acme/",
      role: "Engineer",
      location: "Remote",
      jd_chars: 40,
      researched_at: "2026-09-25T00:00:00Z",
      pages_used: ["http://localhost:8099/acme/"],
    },
    company_brief: {
      summary: "Widgets",
      what_they_do: "Build widgets",
      sources: ["http://localhost:8099/acme/"],
    },
    role: {
      title: "Engineer",
      seniority: "mid",
      responsibilities: ["Ship"],
      requirements: [
        {
          id: "r1",
          text: "TypeScript",
          kind: "technical",
          priority: "must",
        },
      ],
    },
    questions: [
      {
        id: "q1",
        requirement_ids: ["r1"],
        category: "technical",
        prompt: "Talk about TypeScript",
        answer_outline: "Types",
        difficulty: 1,
      },
    ],
    flashcards: [
      {
        id: "f1",
        front: "TS?",
        back: "Typed JS",
        requirement_ids: ["r1"],
      },
    ],
    schedule: {
      days_available: days,
      days: Array.from({ length: days }, (_, i) => ({
        day: i + 1,
        focus: i === days - 1 ? "Mock interview + weak spots" : "TypeScript",
        question_ids: ["q1"],
        minutes: 20,
      })),
    },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  };
}

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

function tempOut(): string {
  const dir = mkdtempSync(join(tmpdir(), "prep-batch-"));
  dirs.push(dir);
  return join(dir, "kits.json");
}

describe("runBatch", () => {
  it("isolates failures, uses each case days, writes Appendix B after each case", async () => {
    const outputPath = tempOut();
    const cases: BatchCase[] = [
      {
        id: "case-a",
        jd: "Engineer\nRequirements:\n- TypeScript",
        company_url: "http://localhost:8099/acme/",
        days: 2,
      },
      {
        id: "case-b",
        jd: "Stub JD",
        company_url: "http://localhost:8099/quietco/",
        days: 5,
      },
      {
        id: "case-fail",
        jd: "",
        company_url: "http://localhost:8099/acme/",
        days: 3,
      },
    ];

    let releaseA!: () => void;
    const holdA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const flushCounts: number[] = [];

    const runCase: CaseRunner = async (input, opts) => {
      expect(opts.allowPrivateHosts).toBe(true);
      const id = cases.find(
        (c) =>
          c.jd === input.jd &&
          c.company_url === input.company_url &&
          c.days === input.days,
      )?.id;

      if (id === "case-a") {
        await holdA;
      }

      if (!input.jd.trim()) {
        throw new PipelineError("EMPTY_JD", "Job description is empty.");
      }
      return { kit: minimalKit(input.days) };
    };

    const logs: string[] = [];
    const { output, elapsedMs } = await runBatch({
      cases,
      outputPath,
      concurrency: 2,
      caseTimeoutMs: 5_000,
      runCase,
      allowPrivateHosts: true,
      now: () => new Date("2026-09-25T12:00:00.000Z"),
      log: (line) => logs.push(line),
      onCaseDone: (entry, partial) => {
        flushCounts.push(partial.kits.length);
        // Once a non-A case lands while A is still held, release A.
        if (entry.id !== "case-a") {
          releaseA();
        }
      },
    });

    expect(flushCounts.some((n) => n >= 1 && n < 3)).toBe(true);

    const parsed = BatchOutputSchema.parse(output);
    expect(parsed.version).toBe("1.0");
    expect(parsed.generated_at).toBe("2026-09-25T12:00:00.000Z");
    expect(parsed.kits).toHaveLength(3);

    const byId = Object.fromEntries(parsed.kits.map((k) => [k.id, k]));
    expect(byId["case-a"]?.status).toBe("ok");
    expect(byId["case-a"]?.kit?.schedule.days_available).toBe(2);
    expect(byId["case-a"]?.error).toBeNull();
    expect(byId["case-b"]?.status).toBe("ok");
    expect(byId["case-b"]?.kit?.schedule.days_available).toBe(5);
    expect(byId["case-fail"]?.status).toBe("failed");
    expect(byId["case-fail"]?.kit).toBeNull();
    expect(byId["case-fail"]?.error?.code).toBe("EMPTY_JD");

    const onDisk = BatchOutputSchema.parse(
      JSON.parse(readFileSync(outputPath, "utf8")),
    );
    expect(onDisk.kits).toHaveLength(3);

    const summary = formatBatchSummary(parsed, elapsedMs);
    expect(summary).toContain("case-a");
    expect(summary).toContain("failed");
    expect(summary).toContain("ok=2 failed=1");
    expect(
      logs.some((l) => l.includes("case-fail") && l.includes("failed")),
    ).toBe(true);
  });

  it("keeps at most concurrency cases in flight", async () => {
    const outputPath = tempOut();
    const cases: BatchCase[] = [1, 2, 3, 4].map((n) => ({
      id: `c${n}`,
      jd: `JD ${n}`,
      company_url: "http://localhost:8099/acme/",
      days: n,
    }));
    let inFlight = 0;
    let peak = 0;

    const runCase: CaseRunner = async (input) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 50));
      inFlight -= 1;
      return { kit: minimalKit(input.days) };
    };

    await runBatch({
      cases,
      outputPath,
      concurrency: 2,
      runCase,
      log: () => {},
    });

    expect(peak).toBe(2);
  });

  it("records CASE_TIMEOUT when a case exceeds the per-case limit", async () => {
    const outputPath = tempOut();
    const runCase: CaseRunner = async () => {
      await new Promise((r) => setTimeout(r, 200));
      return { kit: minimalKit(1) };
    };

    const { output } = await runBatch({
      cases: [
        {
          id: "slow",
          jd: "x",
          company_url: "http://localhost:8099/acme/",
          days: 1,
        },
      ],
      outputPath,
      concurrency: 1,
      caseTimeoutMs: 30,
      runCase,
      log: () => {},
    });

    expect(output.kits).toHaveLength(1);
    expect(output.kits[0]!.status).toBe("failed");
    expect(output.kits[0]!.error?.code).toBe("CASE_TIMEOUT");
  });

  it("writes an empty kits array for zero cases", async () => {
    const outputPath = tempOut();
    const runCase = vi.fn() as unknown as CaseRunner;
    const { output } = await runBatch({
      cases: [],
      outputPath,
      runCase,
      log: () => {},
    });
    expect(output.kits).toEqual([]);
    expect(runCase).not.toHaveBeenCalled();
    const onDisk = BatchOutputSchema.parse(
      JSON.parse(readFileSync(outputPath, "utf8")),
    );
    expect(onDisk.kits).toEqual([]);
  });
});
