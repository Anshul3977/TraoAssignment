import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isLlmNotConfiguredError } from "../llm/errors.js";
import {
  isPipelineError,
  PipelineError,
  runPipeline,
  type PipelineInput,
  type PipelineOptions,
  type PipelineResult,
} from "../pipeline.js";
import type { BatchKitEntry, BatchOutput, Kit } from "../schema/index.js";

/** One row from Appendix B input (`fixtures/cases.json`). */
export type BatchCase = {
  id: string;
  jd: string;
  company_url: string;
  days: number;
};

export type CaseRunner = (
  input: PipelineInput,
  opts: PipelineOptions,
) => Promise<PipelineResult>;

export type RunBatchOptions = {
  cases: BatchCase[];
  outputPath: string;
  /** Max in-flight cases (SPEC/T16: 2). */
  concurrency?: number;
  /** Per-case wall-clock limit in ms (T16: ~4 min). */
  caseTimeoutMs?: number;
  /** Injected runner (tests). Defaults to `runPipeline`. */
  runCase?: CaseRunner;
  /** CLI always allows private hosts for localhost fixtures. */
  allowPrivateHosts?: boolean;
  now?: () => Date;
  log?: (line: string) => void;
  /** Called after each case is recorded and the output file is rewritten. */
  onCaseDone?: (entry: BatchKitEntry, output: BatchOutput) => void;
};

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_CASE_TIMEOUT_MS = 4 * 60 * 1000;

function toBatchError(err: unknown): { code: string; message: string } {
  if (isLlmNotConfiguredError(err)) {
    return { code: err.code, message: err.message };
  }
  if (isPipelineError(err)) {
    return { code: err.code, message: err.message };
  }
  if (err instanceof Error) {
    return { code: "CASE_FAILED", message: err.message };
  }
  return { code: "CASE_FAILED", message: String(err) };
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new PipelineError(
          "CASE_TIMEOUT",
          `Case "${label}" timed out after ${ms}ms.`,
        ),
      );
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
}

function buildOutput(
  generatedAt: string,
  entries: Map<string, BatchKitEntry>,
): BatchOutput {
  return {
    version: "1.0",
    generated_at: generatedAt,
    kits: [...entries.values()],
  };
}

function flushOutput(outputPath: string, output: BatchOutput): void {
  const abs = resolve(outputPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, `${JSON.stringify(output, null, 2)}\n`, "utf8");
}

/**
 * Run every case through the shared pipeline, writing Appendix B after each
 * completion so a crash still leaves partial results.
 */
export async function runBatch(opts: RunBatchOptions): Promise<{
  output: BatchOutput;
  elapsedMs: number;
}> {
  const {
    cases,
    outputPath,
    concurrency = DEFAULT_CONCURRENCY,
    caseTimeoutMs = DEFAULT_CASE_TIMEOUT_MS,
    runCase = runPipeline,
    allowPrivateHosts = true,
    now = () => new Date(),
    log = console.log,
    onCaseDone,
  } = opts;

  const started = Date.now();
  const generatedAt = now().toISOString();
  const entries = new Map<string, BatchKitEntry>();

  // Flush after each case finishes (ok or failed) so partial results survive a crash.
  const record = (entry: BatchKitEntry): void => {
    entries.set(entry.id, entry);
    const output = buildOutput(generatedAt, entries);
    flushOutput(outputPath, output);
    onCaseDone?.(entry, output);
  };

  await mapPool(cases, concurrency, async (c) => {
    const t0 = Date.now();
    log(`[${c.id}] running (days=${c.days})...`);
    try {
      const { kit } = await withTimeout(
        runCase(
          { jd: c.jd, company_url: c.company_url, days: c.days },
          { allowPrivateHosts },
        ),
        caseTimeoutMs,
        c.id,
      );
      record({ id: c.id, status: "ok", kit: kit as Kit, error: null });
      log(`[${c.id}] ok (${Date.now() - t0}ms)`);
    } catch (err) {
      const error = toBatchError(err);
      record({ id: c.id, status: "failed", kit: null, error });
      log(`[${c.id}] failed ${error.code}: ${error.message} (${Date.now() - t0}ms)`);
    }
  });

  // Empty input: still write a valid Appendix B shell.
  if (cases.length === 0) {
    flushOutput(outputPath, buildOutput(generatedAt, entries));
  }

  const output = buildOutput(generatedAt, entries);
  const elapsedMs = Date.now() - started;
  return { output, elapsedMs };
}

/** Format a compact summary table for the CLI stdout. */
export function formatBatchSummary(
  output: BatchOutput,
  elapsedMs: number,
): string {
  const rows = output.kits.map((k) => {
    const detail =
      k.status === "failed" && k.error
        ? `${k.error.code}: ${k.error.message}`
        : "";
    return {
      id: k.id,
      status: k.status,
      detail,
    };
  });
  const idW = Math.max(2, ...rows.map((r) => r.id.length), "id".length);
  const stW = Math.max(6, ...rows.map((r) => r.status.length), "status".length);
  const lines = [
    `${"id".padEnd(idW)}  ${"status".padEnd(stW)}  detail`,
    `${"-".repeat(idW)}  ${"-".repeat(stW)}  ${"-".repeat(6)}`,
    ...rows.map(
      (r) =>
        `${r.id.padEnd(idW)}  ${r.status.padEnd(stW)}  ${r.detail}`,
    ),
  ];
  const ok = output.kits.filter((k) => k.status === "ok").length;
  const failed = output.kits.filter((k) => k.status === "failed").length;
  lines.push("");
  lines.push(
    `ok=${ok} failed=${failed}  elapsed=${(elapsedMs / 1000).toFixed(1)}s`,
  );
  return lines.join("\n");
}
