/**
 * Review Appendix B kits JSON for Checkpoint B (no pipeline changes).
 *
 * Usage:
 *   npx tsx scripts/review-kits.ts out/kits.json
 *   npx tsx scripts/review-kits.ts --input out/kits.json
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

type Req = { id: string; text: string; priority: string; kind?: string };
type Kit = {
  source?: { pages_used?: string[]; company?: string };
  company_brief?: { summary?: string; sources?: string[] };
  role?: { requirements?: Req[]; title?: string };
  questions?: Array<{ category?: string; prompt?: string }>;
  schedule?: {
    days_available?: number;
    days?: Array<{ day: number; question_ids?: string[]; minutes?: number }>;
  };
  coverage?: { uncovered_requirement_ids?: string[]; passes?: number };
  research_log?: Record<string, unknown>;
  notes?: Record<string, unknown>;
};

type BatchEntry = {
  id: string;
  status: string;
  kit: Kit | null;
  error: { code?: string; message?: string } | null;
};

type Expected = { must: string[]; nice: string[] };

function usage(): string {
  return [
    "Usage: npx tsx scripts/review-kits.ts <kits.json>",
    "       npx tsx scripts/review-kits.ts --input <kits.json>",
  ].join("\n");
}

function resolveInput(argv: string[]): string {
  let values: { input?: string; help?: boolean };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      options: {
        input: { type: "string", short: "i" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
      allowPositionals: true,
    }));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error(usage());
    process.exit(2);
  }
  if (values.help) {
    console.log(usage());
    process.exit(0);
  }
  const input = values.input ?? positionals[0];
  if (!input) {
    console.error(usage());
    process.exit(2);
  }
  return resolve(input);
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function loadExpected(): Expected | null {
  const p = join(repoRoot, "fixtures/expected/case-01-requirements.json");
  if (!existsSync(p)) return null;
  const raw = JSON.parse(readFileSync(p, "utf8")) as Expected;
  return raw;
}

function compareExpected(
  reqs: Req[],
  expected: Expected,
): {
  matched: string[];
  missed: string[];
  extra: string[];
  mustNiceMislabels: string[];
} {
  const byNorm = new Map(reqs.map((r) => [norm(r.text), r]));
  const expectedAll = [
    ...expected.must.map((t) => ({ text: t, priority: "must" as const })),
    ...expected.nice.map((t) => ({ text: t, priority: "nice" as const })),
  ];
  const matched: string[] = [];
  const missed: string[] = [];
  const mustNiceMislabels: string[] = [];
  const hit = new Set<string>();

  for (const e of expectedAll) {
    const got = byNorm.get(norm(e.text));
    if (!got) {
      missed.push(`${e.priority}: ${e.text}`);
      continue;
    }
    hit.add(norm(e.text));
    matched.push(`${got.priority}: ${got.text}`);
    if (got.priority !== e.priority) {
      mustNiceMislabels.push(
        `"${got.text}" expected ${e.priority}, got ${got.priority}`,
      );
    }
  }

  const extra = reqs
    .filter((r) => !hit.has(norm(r.text)))
    .map((r) => `${r.priority}: ${r.text}`);

  return { matched, missed, extra, mustNiceMislabels };
}

function hiringPageFound(log: Record<string, unknown> | undefined): string {
  if (!log) return "(no research_log)";
  if (typeof log.hiring_page_found === "boolean") {
    return String(log.hiring_page_found);
  }
  if (typeof log.hiring_pages_found === "boolean") {
    return String(log.hiring_pages_found);
  }
  const pages = log.pages as { hiring?: number } | undefined;
  if (pages && typeof pages.hiring === "number") {
    return pages.hiring > 0 ? `true (pages.hiring=${pages.hiring})` : "false (pages.hiring=0)";
  }
  if (typeof log.company_unreachable === "boolean" && log.company_unreachable) {
    return "n/a (company_unreachable)";
  }
  return JSON.stringify({
    pages: log.pages,
    company_unreachable: log.company_unreachable,
  });
}

function reviewEntry(entry: BatchEntry, expected: Expected | null): string {
  const lines: string[] = [];
  lines.push(`## ${entry.id}`);
  lines.push(
    `status=${entry.status}` +
      (entry.error
        ? ` error=${entry.error.code ?? "?"}: ${entry.error.message ?? ""}`
        : ""),
  );

  const kit = entry.kit;
  if (!kit) {
    lines.push("(no kit)");
    lines.push("");
    return lines.join("\n");
  }

  const reqs = kit.role?.requirements ?? [];
  const must = reqs.filter((r) => r.priority === "must");
  const nice = reqs.filter((r) => r.priority === "nice");
  lines.push(`must=${must.length} nice=${nice.length}`);
  lines.push(
    `uncovered_requirement_ids=${JSON.stringify(kit.coverage?.uncovered_requirement_ids ?? [])}`,
  );
  lines.push(`coverage.passes=${kit.coverage?.passes ?? "?"}`);

  const daysAvail = kit.schedule?.days_available;
  const days = kit.schedule?.days ?? [];
  lines.push(`schedule days=${days.length} vs days_available=${daysAvail}`);
  const emptyDays = days.filter((d) => !(d.question_ids && d.question_ids.length));
  const badMinutes = days.filter(
    (d) => typeof d.minutes !== "number" || !Number.isInteger(d.minutes),
  );
  if (emptyDays.length) {
    lines.push(
      `FLAG empty days: ${emptyDays.map((d) => d.day).join(", ")}`,
    );
  }
  if (badMinutes.length) {
    lines.push(
      `FLAG non-integer minutes: ${badMinutes.map((d) => `day ${d.day}=${String(d.minutes)}`).join(", ")}`,
    );
  }

  lines.push(`hiring page found: ${hiringPageFound(kit.research_log)}`);
  const pagesUsed = kit.source?.pages_used ?? [];
  lines.push(`pages_used count=${pagesUsed.length}`);

  const disc =
    (kit.research_log?.discussion as { results?: unknown[] } | undefined)
      ?.results ??
    (kit.research_log?.discussion_results as unknown[] | undefined) ??
    (Array.isArray(kit.research_log?.discussion)
      ? (kit.research_log?.discussion as unknown[])
      : undefined);
  const discCount = Array.isArray(disc)
    ? disc.length
    : typeof kit.research_log?.discussion_count === "number"
      ? kit.research_log.discussion_count
      : "?";
  lines.push(`discussion results count=${discCount}`);

  const summary = kit.company_brief?.summary ?? "";
  lines.push(`company_brief.summary (first 200): ${summary.slice(0, 200)}`);
  lines.push(`notes.thin_jd=${String(kit.notes?.thin_jd ?? "(absent)")}`);

  const cobol = reqs.filter((r) => /cobol/i.test(r.text));
  if (cobol.length) {
    lines.push(`FLAG COBOL in requirements: ${cobol.map((r) => r.text).join(" | ")}`);
  }

  const briefSources = kit.company_brief?.sources ?? [];
  const pagesSet = new Set(pagesUsed);
  const orphanSources = briefSources.filter((s) => !pagesSet.has(s));
  if (orphanSources.length) {
    lines.push(
      `FLAG brief sources not in pages_used: ${orphanSources.join(", ")}`,
    );
  }

  const uncovered = new Set(kit.coverage?.uncovered_requirement_ids ?? []);
  const uncoveredMust = must.filter((r) => uncovered.has(r.id));
  if (uncoveredMust.length) {
    lines.push(
      `FLAG uncovered must: ${uncoveredMust.map((r) => `${r.id}:${r.text}`).join(" | ")}`,
    );
  }

  const isAcme =
    entry.id === "case-01" ||
    entry.id === "case-05" ||
    /acme/i.test(kit.source?.company ?? "");
  if (isAcme && expected && (entry.id === "case-01" || entry.id === "case-05")) {
    const cmp = compareExpected(reqs, expected);
    lines.push("--- vs fixtures/expected ---");
    lines.push(`matched (${cmp.matched.length}):`);
    for (const m of cmp.matched) lines.push(`  + ${m}`);
    lines.push(`missed (${cmp.missed.length}):`);
    for (const m of cmp.missed) lines.push(`  - ${m}`);
    lines.push(`extra (${cmp.extra.length}):`);
    for (const m of cmp.extra) lines.push(`  * ${m}`);
    lines.push(`must/nice mislabels (${cmp.mustNiceMislabels.length}):`);
    for (const m of cmp.mustNiceMislabels) lines.push(`  ! ${m}`);
  }

  lines.push("");
  return lines.join("\n");
}

function main(): void {
  const inputPath = resolveInput(process.argv.slice(2));
  if (!existsSync(inputPath)) {
    console.error(`File not found: ${inputPath}`);
    process.exit(2);
  }
  const raw = JSON.parse(readFileSync(inputPath, "utf8")) as {
    kits?: BatchEntry[];
  };
  const kits = raw.kits ?? [];
  const expected = loadExpected();

  console.log(`# review-kits: ${inputPath}`);
  console.log(`cases=${kits.length}`);
  console.log("");
  for (const entry of kits) {
    console.log(reviewEntry(entry, expected));
  }
}

main();
