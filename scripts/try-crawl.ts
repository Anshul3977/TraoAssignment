/**
 * Checkpoint A probe: crawl + rankLinks + searchDiscussion (no LLM) for one URL.
 * Usage: npx tsx scripts/try-crawl.ts <url>
 *
 * Does not modify packages/core — only wraps fetchImpl to count requests and
 * record fetch order / robots.txt hits for the report.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  cleanPage,
  classifyPage,
  crawl,
  LITTLE_EXTRACTABLE_REASON,
  LITTLE_EXTRACTABLE_TEXT_CHARS,
  MAX_PAGE_BUDGET,
  rankLinks,
  resetHostLimiter,
  resetRobotsCache,
  scorePageContent,
  searchDiscussion,
  type CrawledPage,
  type PageKind,
  type ResearchBundle,
} from "../packages/core/src/retrieval/index.js";

const SITE_TIMEOUT_MS = 90_000;

type FetchedPageLog = {
  order: number;
  url: string;
  score: number;
  kind: PageKind;
  textChars: number;
  note?: string;
};

type RobotsLog = {
  origin: string;
  event: "fetched" | "missing_or_unreadable" | "disallowed_url";
  detail?: string;
};

type RunReport = {
  url: string;
  timedOut: boolean;
  elapsedMs: number;
  totalRequests: number;
  pagesFetched: FetchedPageLog[];
  skipped: Array<{ url: string; reason: string }>;
  robots: RobotsLog[];
  discussion: {
    companyName: string;
    pages: Array<{ url: string; title: string; provider: string }>;
    log: Array<{ provider: string; status: string; detail?: string; query?: string }>;
  } | null;
  bundleSummary: {
    unreachable: boolean;
    hiring: string[];
    about: string[];
    other: string[];
  } | null;
  problems: string[];
};

function isLocalUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (
      u.hostname === "localhost" ||
      u.hostname === "127.0.0.1" ||
      u.hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

function slugFor(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/[^a-z0-9.-]+/gi, "_");
    const pathPart = u.pathname.replace(/\/+/g, "_").replace(/^_|_$/g, "") || "root";
    return `${host}${pathPart ? `_${pathPart}` : ""}`.slice(0, 80);
  } catch {
    return "invalid";
  }
}

function createInstrumentedFetch(companyUrl: string): {
  fetchImpl: typeof fetch;
  getRequestCount: () => number;
  getPageLogs: () => FetchedPageLog[];
  getRobotsLogs: () => RobotsLog[];
} {
  let requestCount = 0;
  let pageOrder = 0;
  const pageLogs: FetchedPageLog[] = [];
  const robotsLogs: RobotsLog[] = [];
  const robotsOriginsSeen = new Set<string>();
  let companyOrigin = "";
  try {
    companyOrigin = new URL(companyUrl).origin;
  } catch {
    companyOrigin = "";
  }

  const fetchImpl: typeof fetch = async (input, init) => {
    requestCount += 1;
    const href =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    let parsed: URL | null = null;
    try {
      parsed = new URL(href);
    } catch {
      /* ignore */
    }

    const res = await globalThis.fetch(input, init);

    if (parsed && parsed.pathname === "/robots.txt") {
      const origin = parsed.origin;
      if (!robotsOriginsSeen.has(origin)) {
        robotsOriginsSeen.add(origin);
        if (res.ok) {
          robotsLogs.push({ origin, event: "fetched", detail: `status_${res.status}` });
        } else {
          robotsLogs.push({
            origin,
            event: "missing_or_unreadable",
            detail: `status_${res.status}`,
          });
        }
      }
      return res;
    }

    // Only classify same-origin company pages for ordered crawl log (skip search providers)
    const ct = res.headers.get("content-type") ?? "";
    const looksHtml =
      ct.includes("text/html") ||
      ct.includes("application/xhtml") ||
      (!ct && res.ok);
    const sameCompanyOrigin = Boolean(parsed && companyOrigin && parsed.origin === companyOrigin);

    if (res.ok && looksHtml && parsed && sameCompanyOrigin) {
      try {
        const clone = res.clone();
        const body = await clone.text();
        const cleaned = cleanPage(body, parsed.href);
        const scores = scorePageContent(cleaned.text, cleaned.title, cleaned.description);
        const kind = classifyPage(scores);
        pageOrder += 1;
        const note =
          cleaned.text.trim().length < LITTLE_EXTRACTABLE_TEXT_CHARS
            ? LITTLE_EXTRACTABLE_REASON
            : undefined;
        pageLogs.push({
          order: pageOrder,
          url: cleaned.url,
          score: scores.total,
          kind,
          textChars: cleaned.text.trim().length,
          note,
        });
      } catch {
        /* classification fail — still count as a request */
      }
    }

    return res;
  };

  return {
    fetchImpl,
    getRequestCount: () => requestCount,
    getPageLogs: () => pageLogs,
    getRobotsLogs: () => robotsLogs,
  };
}

function bestUrl(pages: CrawledPage[]): string | null {
  if (pages.length === 0) return null;
  const ranked = rankLinks(pages.map((p) => ({ url: p.url, score: p.score })));
  return ranked[0]?.url ?? null;
}

async function runOne(url: string): Promise<RunReport> {
  resetRobotsCache();
  resetHostLimiter();

  const instrument = createInstrumentedFetch(url);
  const allowPrivateHosts = isLocalUrl(url);
  const started = Date.now();
  const problems: string[] = [];
  let timedOut = false;

  const work = async (): Promise<{
    bundle: ResearchBundle;
    discussion: Awaited<ReturnType<typeof searchDiscussion>>;
  }> => {
    const bundle = await crawl(url, {
      fetchImpl: instrument.fetchImpl,
      allowPrivateHosts,
      // Keep default per-request timeouts; do not raise for long runs
    });

    const discussion = await searchDiscussion(url, {
      fetchImpl: instrument.fetchImpl,
      allowPrivateHosts,
      homepageTitle: bundle.homepage?.title,
      // Prefer not to pass huge HTML; title is enough for company name
    });

    return { bundle, discussion };
  };

  let bundle: ResearchBundle | null = null;
  let discussion: Awaited<ReturnType<typeof searchDiscussion>> | null = null;

  try {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      work().finally(() => {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      }),
      new Promise<"timeout">((resolve) => {
        timeoutId = setTimeout(() => resolve("timeout"), SITE_TIMEOUT_MS);
      }),
    ]);

    if (result === "timeout") {
      timedOut = true;
      problems.push(`site run exceeded ~${SITE_TIMEOUT_MS / 1000}s timeout`);
    } else {
      bundle = result.bundle;
      discussion = result.discussion;
    }
  } catch (err) {
    problems.push(
      `run threw: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const elapsedMs = Date.now() - started;
  const pageLogs = instrument.getPageLogs();
  const robots = [...instrument.getRobotsLogs()];

  const skipped = bundle?.skipped ?? [];
  for (const s of skipped) {
    if (s.reason === "robots_disallowed") {
      try {
        robots.push({
          origin: new URL(s.url).origin,
          event: "disallowed_url",
          detail: s.url,
        });
      } catch {
        robots.push({
          origin: s.url,
          event: "disallowed_url",
          detail: s.url,
        });
      }
    }
  }

  if (bundle?.unreachable) {
    problems.push("company unreachable (seed failed or zero pages)");
  }

  for (const p of pageLogs) {
    if (p.note) {
      problems.push(`${p.note}: ${p.url}`);
    }
  }

  // Honesty: quietco must not be reported as hiring
  if (url.includes("/quietco") && bundle && bundle.hiringPages.length > 0) {
    problems.push(
      `HONESTY: quietco falsely classified hiring page(s): ${bundle.hiringPages
        .map((p) => p.url)
        .join(", ")}`,
    );
  }

  return {
    url,
    timedOut,
    elapsedMs,
    totalRequests: instrument.getRequestCount(),
    pagesFetched: pageLogs,
    skipped,
    robots,
    discussion: discussion
      ? {
          companyName: discussion.companyName,
          pages: discussion.pages.map((p) => ({
            url: p.url,
            title: p.title,
            provider: p.provider,
          })),
          log: discussion.log,
        }
      : null,
    bundleSummary: bundle
      ? {
          unreachable: bundle.unreachable,
          hiring: bundle.hiringPages.map((p) => p.url),
          about: bundle.aboutPages.map((p) => p.url),
          other: bundle.otherPages.map((p) => p.url),
        }
      : null,
    problems,
  };
}

function printReport(report: RunReport): void {
  const lines: string[] = [];
  const out = (s = "") => {
    lines.push(s);
    console.log(s);
  };

  out(`=== try-crawl: ${report.url} ===`);
  out(`elapsed_ms=${report.elapsedMs} total_requests=${report.totalRequests} timed_out=${report.timedOut}`);
  out(`max_page_budget=${MAX_PAGE_BUDGET}`);
  out("");

  out("--- pages fetched (order) ---");
  if (report.pagesFetched.length === 0) {
    out("(none)");
  } else {
    for (const p of report.pagesFetched) {
      const note = p.note ? ` | ${p.note}` : "";
      out(
        `${p.order}. [${p.kind}] score=${p.score} textChars=${p.textChars} ${p.url}${note}`,
      );
    }
  }
  out("");

  out("--- skipped sources ---");
  if (report.skipped.length === 0) {
    out("(none)");
  } else {
    const budget = report.skipped.filter((s) => s.reason === "budget_exhausted");
    const otherSkipped = report.skipped.filter((s) => s.reason !== "budget_exhausted");
    for (const s of otherSkipped) {
      out(`- ${s.reason}: ${s.url}`);
    }
    if (budget.length > 0) {
      out(`- budget_exhausted: ${budget.length} URLs left in frontier (see JSON log for full list)`);
      for (const s of budget.slice(0, 8)) {
        out(`    e.g. ${s.url}`);
      }
      if (budget.length > 8) out(`    ... +${budget.length - 8} more`);
    }
  }
  out("");

  out("--- robots decisions ---");
  if (report.robots.length === 0) {
    out("(none recorded)");
  } else {
    for (const r of report.robots) {
      out(`- ${r.event} ${r.origin}${r.detail ? ` (${r.detail})` : ""}`);
    }
  }
  out("");

  out("--- discussion ---");
  if (!report.discussion) {
    out("(not run — timed out or error)");
  } else {
    out(`companyName=${report.discussion.companyName}`);
    out(`pages=${report.discussion.pages.length}`);
    for (const p of report.discussion.pages) {
      out(`  - [${p.provider}] ${p.title} · ${p.url}`);
    }
    out("log:");
    for (const e of report.discussion.log) {
      out(
        `  - ${e.provider} ${e.status}${e.query ? ` q="${e.query}"` : ""}${e.detail ? ` ${e.detail}` : ""}`,
      );
    }
  }
  out("");

  out("--- bundle summary ---");
  if (!report.bundleSummary) {
    out("(none)");
  } else {
    out(`unreachable=${report.bundleSummary.unreachable}`);
    out(`hiring=${JSON.stringify(report.bundleSummary.hiring)}`);
    out(`about=${JSON.stringify(report.bundleSummary.about)}`);
    out(`other_count=${report.bundleSummary.other.length}`);
  }
  out("");

  out("--- problems ---");
  if (report.problems.length === 0) {
    out("(none)");
  } else {
    for (const p of report.problems) out(`- ${p}`);
  }

  // Persist raw log next to checkpoint report
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dir = path.join(root, ".loop", "checkpoint-a");
  mkdirSync(dir, { recursive: true });
  const logPath = path.join(dir, `${slugFor(report.url)}.log.txt`);
  writeFileSync(logPath, lines.join("\n") + "\n", "utf8");
  const jsonPath = path.join(dir, `${slugFor(report.url)}.json`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`\nWrote ${logPath}`);
}

async function main(): Promise<void> {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: npx tsx scripts/try-crawl.ts <url>");
    process.exit(2);
  }

  const report = await runOne(url);
  printReport(report);

  // Expose machine-readable one-liner for callers
  const hiring = report.bundleSummary?.hiring[0] ?? null;
  const about = report.bundleSummary?.about[0] ?? null;
  console.log(
    `\nCHECKPOINT_ROW|${url}|hiring=${hiring ?? ""}|about=${about ?? ""}|problems=${report.problems.join("; ") || "none"}|pages=${report.pagesFetched.length}|reqs=${report.totalRequests}|ms=${report.elapsedMs}|timeout=${report.timedOut}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
