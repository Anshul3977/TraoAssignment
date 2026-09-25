import { parse as parseDomain } from "tldts";
import { cleanPage, type CleanPageResult } from "./cleanPage.js";
import {
  classifyPage,
  rankLinks,
  scoreLink,
  scorePageContent,
  type PageKind,
} from "./rankLinks.js";
import { safeFetch, type SafeFetchOptions } from "./safeFetch.js";

export const MAX_CRAWL_DEPTH = 3;
export const MAX_PAGE_BUDGET = 15;

/** Extracted main text shorter than this is treated as a likely client-rendered shell. */
export const LITTLE_EXTRACTABLE_TEXT_CHARS = 40;

/** Recorded on `skipped` when cheerio yields almost no text — not a confirmed missing hiring page. */
export const LITTLE_EXTRACTABLE_REASON =
  "little extractable content (likely client-rendered)";

export type CrawledPage = {
  url: string;
  title: string;
  description: string;
  text: string;
  links: CleanPageResult["links"];
  kind: PageKind;
  /** Content-derived net score after fetch. */
  score: number;
};

export type SkippedPage = {
  url: string;
  reason: string;
};

export type ResearchBundle = {
  homepage: CrawledPage | null;
  aboutPages: CrawledPage[];
  hiringPages: CrawledPage[];
  otherPages: CrawledPage[];
  skipped: SkippedPage[];
  unreachable: boolean;
};

export type CrawlOptions = SafeFetchOptions & {
  maxDepth?: number;
  maxPages?: number;
};

type FrontierItem = {
  url: string;
  depth: number;
  score: number;
  /** True when this URL is the crawl seed (company_url). */
  isSeed?: boolean;
};

function normalizeUrl(href: string): string | null {
  try {
    const u = new URL(href);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    // Collapse default ports
    if (
      (u.protocol === "http:" && u.port === "80") ||
      (u.protocol === "https:" && u.port === "443")
    ) {
      u.port = "";
    }
    return u.href;
  } catch {
    return null;
  }
}

/** Path prefix the crawl must stay under (e.g. `/acme/` from `…/acme/`). */
export function pathPrefixForStart(start: URL): string {
  let pathname = start.pathname || "/";
  // If the seed looks like a file (has an extension), confine to its directory
  if (/\.[a-z0-9]+$/i.test(pathname) && !pathname.endsWith("/")) {
    pathname = pathname.slice(0, pathname.lastIndexOf("/") + 1) || "/";
  } else if (!pathname.endsWith("/")) {
    pathname = `${pathname}/`;
  }
  return pathname;
}

export function isSameOriginUnderPrefix(candidate: URL, start: URL, prefix: string): boolean {
  if (candidate.origin !== start.origin) return false;
  const path = candidate.pathname || "/";
  if (prefix === "/") return true;
  return path === prefix.slice(0, -1) || path.startsWith(prefix);
}

/**
 * True when both hosts share the same registrable domain (eTLD+1 via tldts),
 * e.g. about.gitlab.com ↔ handbook.gitlab.com, or foo.example.co.uk ↔ bar.example.co.uk.
 * Hostnames without a public suffix (localhost, IPs) only match when hostnames are equal.
 */
export function sameRegistrableDomain(a: URL, b: URL): boolean {
  const da = parseDomain(a.hostname);
  const db = parseDomain(b.hostname);
  if (da.domain && db.domain) {
    return da.domain === db.domain;
  }
  // localhost / IP literals / unknown suffixes: require exact hostname match
  return a.hostname === b.hostname;
}

/**
 * Crawl scope: same registrable domain as the seed. Same-origin URLs must stay under the
 * seed path prefix (fixture isolation). Different subdomains of that domain are allowed
 * on any path (e.g. careers.company.com from www.company.com).
 */
export function isAllowedCrawlTarget(candidate: URL, start: URL, prefix: string): boolean {
  if (candidate.protocol !== start.protocol) return false;
  if (!sameRegistrableDomain(candidate, start)) return false;
  if (candidate.host === start.host) {
    return isSameOriginUnderPrefix(candidate, start, prefix);
  }
  return true;
}

function toCrawledPage(cleaned: CleanPageResult, kind: PageKind, score: number): CrawledPage {
  return {
    url: cleaned.url,
    title: cleaned.title,
    description: cleaned.description,
    text: cleaned.text,
    links: cleaned.links,
    kind,
    score,
  };
}

function parseSitemapLocs(xml: string, start: URL, prefix: string): string[] {
  const locs: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const raw = m[1]!.trim();
    const norm = normalizeUrl(raw);
    if (!norm) continue;
    try {
      const u = new URL(norm);
      if (!isAllowedCrawlTarget(u, start, prefix)) continue;
      locs.push(norm);
    } catch {
      // skip
    }
  }
  return locs;
}

async function tryLoadSitemap(
  start: URL,
  prefix: string,
  opts: CrawlOptions,
): Promise<{ urls: string[]; skipped: SkippedPage[] }> {
  const skipped: SkippedPage[] = [];
  const candidates = [
    new URL("sitemap.xml", `${start.origin}${prefix}`).href,
    new URL("/sitemap.xml", start.origin).href,
  ];
  const seen = new Set<string>();

  for (const sitemapUrl of candidates) {
    if (seen.has(sitemapUrl)) continue;
    seen.add(sitemapUrl);
    const result = await safeFetch(sitemapUrl, opts);
    if (!result.ok) {
      // Missing sitemap is normal — only record unexpected failures lightly
      if (result.reason !== "http_error" || result.status !== 404) {
        skipped.push({ url: sitemapUrl, reason: result.reason });
      }
      continue;
    }
    const ct = result.contentType;
    if (!ct.includes("xml") && !ct.includes("text/plain") && !ct.includes("html")) {
      skipped.push({ url: sitemapUrl, reason: "unsupported_content_type" });
      continue;
    }
    return { urls: parseSitemapLocs(result.body, start, prefix), skipped };
  }
  return { urls: [], skipped };
}

function pickBest(frontier: Map<string, FrontierItem>): FrontierItem | null {
  if (frontier.size === 0) return null;
  const ranked = rankLinks([...frontier.values()].map((f) => ({ url: f.url, score: f.score })));
  const bestUrl = ranked[0]!.url;
  const item = frontier.get(bestUrl)!;
  frontier.delete(bestUrl);
  return item;
}

function enqueue(
  frontier: Map<string, FrontierItem>,
  visited: Set<string>,
  item: FrontierItem,
  maxDepth: number,
): void {
  if (item.depth > maxDepth) return;
  if (visited.has(item.url)) return;
  const existing = frontier.get(item.url);
  if (existing) {
    // Keep higher score; prefer shallower depth when scores tie
    if (
      item.score > existing.score ||
      (item.score === existing.score && item.depth < existing.depth)
    ) {
      frontier.set(item.url, item);
    }
    return;
  }
  frontier.set(item.url, item);
}

/**
 * Crawl from company_url: same registrable domain (+ path-prefix on the seed host),
 * BFS depth ≤ 3, ≤ 15 pages, fetching frontier URLs in deterministic score order.
 */
export async function crawl(companyUrl: string, opts: CrawlOptions = {}): Promise<ResearchBundle> {
  const maxDepth = opts.maxDepth ?? MAX_CRAWL_DEPTH;
  const maxPages = opts.maxPages ?? MAX_PAGE_BUDGET;

  const empty: ResearchBundle = {
    homepage: null,
    aboutPages: [],
    hiringPages: [],
    otherPages: [],
    skipped: [],
    unreachable: true,
  };

  let start: URL;
  try {
    start = new URL(companyUrl);
  } catch {
    return { ...empty, skipped: [{ url: companyUrl, reason: "invalid_url" }] };
  }
  if (start.protocol !== "http:" && start.protocol !== "https:") {
    return { ...empty, skipped: [{ url: companyUrl, reason: "unsupported_protocol" }] };
  }

  const seedNorm = normalizeUrl(start.href);
  if (!seedNorm) {
    return { ...empty, skipped: [{ url: companyUrl, reason: "invalid_url" }] };
  }
  start = new URL(seedNorm);
  const prefix = pathPrefixForStart(start);

  const skipped: SkippedPage[] = [];
  const visited = new Set<string>();
  const frontier = new Map<string, FrontierItem>();

  // Seed homepage first so it is fetched before sitemap-only URLs of equal score
  enqueue(frontier, visited, { url: seedNorm, depth: 0, score: 1000, isSeed: true }, maxDepth);

  const sitemap = await tryLoadSitemap(start, prefix, opts);
  skipped.push(...sitemap.skipped);
  for (const loc of sitemap.urls) {
    const linkScore = scoreLink("", loc);
    enqueue(
      frontier,
      visited,
      { url: loc, depth: 1, score: linkScore.total },
      maxDepth,
    );
  }

  const aboutPages: CrawledPage[] = [];
  const hiringPages: CrawledPage[] = [];
  const otherPages: CrawledPage[] = [];
  let homepage: CrawledPage | null = null;
  let pagesFetched = 0;
  let seedFailed = false;

  while (pagesFetched < maxPages) {
    const next = pickBest(frontier);
    if (!next) break;

    visited.add(next.url);
    const fetchResult = await safeFetch(next.url, opts);

    if (!fetchResult.ok) {
      skipped.push({ url: next.url, reason: fetchResult.reason });
      if (next.isSeed) seedFailed = true;
      continue;
    }

    // Prefer final URL after redirects, still must stay under prefix
    const finalNorm = normalizeUrl(fetchResult.finalUrl) ?? next.url;
    let finalUrl: URL;
    try {
      finalUrl = new URL(finalNorm);
    } catch {
      skipped.push({ url: next.url, reason: "invalid_redirect" });
      continue;
    }
    if (!isAllowedCrawlTarget(finalUrl, start, prefix)) {
      skipped.push({ url: finalNorm, reason: "off_prefix_redirect" });
      continue;
    }

    visited.add(finalNorm);
    pagesFetched += 1;

    const cleaned = cleanPage(fetchResult.body, finalNorm);
    const thinShell = cleaned.text.trim().length < LITTLE_EXTRACTABLE_TEXT_CHARS;
    if (thinShell) {
      // Honest note: empty SPA shells are not evidence that hiring is missing.
      skipped.push({ url: finalNorm, reason: LITTLE_EXTRACTABLE_REASON });
    }

    const contentScores = scorePageContent(cleaned.text, cleaned.title, cleaned.description);
    // Thin shells must not classify as hiring/about from title-only noise.
    const kind: PageKind = thinShell ? "other" : classifyPage(contentScores);
    const page = toCrawledPage(cleaned, kind, thinShell ? 0 : contentScores.total);

    if (next.isSeed || finalNorm === seedNorm) {
      homepage = page;
    }

    if (kind === "hiring") hiringPages.push(page);
    else if (kind === "about") aboutPages.push(page);
    else otherPages.push(page);

    // Discover links for BFS expansion
    const childDepth = next.depth + 1;
    if (childDepth <= maxDepth) {
      for (const link of cleaned.links) {
        const norm = normalizeUrl(link.href);
        if (!norm) continue;
        let child: URL;
        try {
          child = new URL(norm);
        } catch {
          continue;
        }
        if (!isAllowedCrawlTarget(child, start, prefix)) continue;
        // Skip non-http already handled; skip obvious asset extensions
        if (/\.(css|js|png|jpe?g|gif|svg|ico|woff2?|ttf|zip|pdf)$/i.test(child.pathname)) {
          continue;
        }
        const ranked = scoreLink(link.text, norm);
        if (ranked.penalty >= 10) continue; // mailto etc.
        enqueue(
          frontier,
          visited,
          { url: norm, depth: childDepth, score: ranked.total },
          maxDepth,
        );
      }
    }
  }

  // Anything left unfetched when budget exhausted is recorded as skipped
  for (const leftover of frontier.values()) {
    skipped.push({ url: leftover.url, reason: "budget_exhausted" });
  }

  const unreachable = homepage === null && (seedFailed || pagesFetched === 0);

  return {
    homepage,
    aboutPages,
    hiringPages,
    otherPages,
    skipped,
    unreachable,
  };
}
