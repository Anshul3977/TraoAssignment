import * as cheerio from "cheerio";
import { cleanPage, type CleanPageResult } from "./cleanPage.js";
import { safeFetch, type SafeFetchOptions } from "./safeFetch.js";

export const MAX_DISCUSSION_PAGES = 3;

export type DiscussionLogEntry = {
  provider: string;
  status: "ok" | "empty" | "error" | "skipped";
  detail?: string;
  query?: string;
};

export type DiscussionPage = {
  url: string;
  title: string;
  description: string;
  text: string;
  provider: string;
};

export type SearchDiscussionResult = {
  /** Fetched & cleaned discussion pages (≤3). Empty array when nothing useful found. */
  pages: DiscussionPage[];
  companyName: string;
  log: DiscussionLogEntry[];
};

export type SearchDiscussionOptions = SafeFetchOptions & {
  /** Homepage `<title>` from crawl/cleanPage. */
  homepageTitle?: string;
  /** Raw homepage HTML — used only to read `og:site_name`. */
  homepageHtml?: string;
  /** Pre-extracted og:site_name (wins over parsing homepageHtml). */
  ogSiteName?: string;
  /** Override env SEARCH_API_KEY (Brave / Tavily). */
  searchApiKey?: string;
  /** Max discussion pages to fetch (default 3). */
  maxPages?: number;
};

type RawHit = {
  url: string;
  title: string;
  snippet: string;
  provider: string;
};

const QUERY_SUFFIXES = ["interview process", "interview experience"] as const;

/**
 * Prefer homepage title, then og:site_name, then the registrable-ish domain label.
 */
export function inferCompanyName(opts: {
  companyUrl: string;
  homepageTitle?: string;
  ogSiteName?: string;
  homepageHtml?: string;
}): string {
  const fromTitle = cleanTitleSegment(opts.homepageTitle);
  if (fromTitle) return fromTitle;

  const og =
    (opts.ogSiteName && opts.ogSiteName.trim()) ||
    (opts.homepageHtml ? extractOgSiteName(opts.homepageHtml) : "");
  if (og) return og;

  return companyFromDomain(opts.companyUrl);
}

export function extractOgSiteName(html: string): string {
  const $ = cheerio.load(html);
  const raw =
    $('meta[property="og:site_name"]').attr("content") ??
    $('meta[name="og:site_name"]').attr("content") ??
    "";
  return raw.replace(/\s+/g, " ").trim();
}

function cleanTitleSegment(title: string | undefined): string {
  if (!title) return "";
  const trimmed = title.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  // Drop common chrome after a separator ("Acme Corp | Careers")
  const segment = trimmed.split(/\s*[|\u2013\u2014]\s*|\s+-\s+/)[0]?.trim() ?? trimmed;
  return segment;
}

function companyFromDomain(companyUrl: string): string {
  try {
    const host = new URL(companyUrl).hostname.replace(/^www\./i, "");
    const label = host.split(".")[0] ?? host;
    return label || host;
  } catch {
    return "company";
  }
}

function buildQueries(companyName: string): string[] {
  return QUERY_SUFFIXES.map((suffix) => `${companyName} ${suffix}`);
}

function mentionsCompany(hit: RawHit, companyName: string): boolean {
  const needle = companyName.trim().toLowerCase();
  if (!needle) return false;
  const hay = `${hit.title} ${hit.snippet} ${hit.url}`.toLowerCase();
  return hay.includes(needle);
}

function normalizeHitUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

async function fetchText(
  url: string,
  opts: SearchDiscussionOptions,
  init?: RequestInit,
): Promise<{ ok: true; body: string; contentType: string } | { ok: false; reason: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      ...init,
      signal: ctrl.signal,
      headers: {
        Accept: "application/json, text/html, */*",
        "User-Agent":
          "InterviewPrepKit/0.1 (+https://github.com/prep; research bot)",
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      return { ok: false, reason: `http_${res.status}` };
    }
    const body = await res.text();
    const contentType = res.headers.get("content-type") ?? "";
    return { ok: true, body, contentType };
  } catch (err) {
    const name = err instanceof Error ? err.name : "error";
    return { ok: false, reason: name === "AbortError" ? "timeout" : "network_error" };
  } finally {
    clearTimeout(timer);
  }
}

async function searchHnAlgolia(
  query: string,
  opts: SearchDiscussionOptions,
): Promise<{ hits: RawHit[]; error?: string }> {
  const url = new URL("https://hn.algolia.com/api/v1/search");
  url.searchParams.set("query", query);
  url.searchParams.set("tags", "story");
  url.searchParams.set("hitsPerPage", "8");

  const res = await fetchText(url.href, opts);
  if (!res.ok) return { hits: [], error: res.reason };

  try {
    const data = JSON.parse(res.body) as {
      hits?: Array<{
        title?: string;
        url?: string | null;
        story_text?: string | null;
        objectID?: string;
      }>;
    };
    const hits: RawHit[] = [];
    for (const h of data.hits ?? []) {
      const title = (h.title ?? "").trim();
      const target =
        (h.url && normalizeHitUrl(h.url)) ||
        (h.objectID
          ? `https://news.ycombinator.com/item?id=${encodeURIComponent(h.objectID)}`
          : null);
      if (!target) continue;
      hits.push({
        url: target,
        title,
        snippet: (h.story_text ?? "").slice(0, 400),
        provider: "hn_algolia",
      });
    }
    return { hits };
  } catch {
    return { hits: [], error: "invalid_json" };
  }
}

function parseDuckDuckGoHtml(html: string): RawHit[] {
  const $ = cheerio.load(html);
  const hits: RawHit[] = [];
  const seen = new Set<string>();

  $("a.result__a").each((_, el) => {
    const href = $(el).attr("href");
    const title = $(el).text().replace(/\s+/g, " ").trim();
    if (!href || !title) return;
    // DDG sometimes wraps redirects; try uddg= param first
    let resolved = href;
    try {
      const u = new URL(href, "https://html.duckduckgo.com");
      const uddg = u.searchParams.get("uddg");
      if (uddg) resolved = uddg;
    } catch {
      /* keep href */
    }
    const norm = normalizeHitUrl(resolved);
    if (!norm || seen.has(norm)) return;
    seen.add(norm);
    const snippet = $(el)
      .closest(".result")
      .find(".result__snippet")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();
    hits.push({ url: norm, title, snippet, provider: "duckduckgo" });
  });

  return hits;
}

async function searchDuckDuckGo(
  query: string,
  opts: SearchDiscussionOptions,
): Promise<{ hits: RawHit[]; error?: string }> {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);

  const res = await fetchText(url.href, opts, {
    headers: { Accept: "text/html" },
  });
  if (!res.ok) return { hits: [], error: res.reason };

  try {
    return { hits: parseDuckDuckGoHtml(res.body) };
  } catch {
    return { hits: [], error: "parse_error" };
  }
}

async function searchBrave(
  query: string,
  apiKey: string,
  opts: SearchDiscussionOptions,
): Promise<{ hits: RawHit[]; error?: string }> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "8");

  const res = await fetchText(url.href, opts, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
  });
  if (!res.ok) return { hits: [], error: res.reason };

  try {
    const data = JSON.parse(res.body) as {
      web?: { results?: Array<{ url?: string; title?: string; description?: string }> };
    };
    const hits: RawHit[] = [];
    for (const r of data.web?.results ?? []) {
      const norm = r.url ? normalizeHitUrl(r.url) : null;
      if (!norm) continue;
      hits.push({
        url: norm,
        title: (r.title ?? "").trim(),
        snippet: (r.description ?? "").trim(),
        provider: "brave",
      });
    }
    return { hits };
  } catch {
    return { hits: [], error: "invalid_json" };
  }
}

async function searchTavily(
  query: string,
  apiKey: string,
  opts: SearchDiscussionOptions,
): Promise<{ hits: RawHit[]; error?: string }> {
  const res = await fetchText("https://api.tavily.com/search", opts, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: 8,
      include_answer: false,
    }),
  });
  if (!res.ok) return { hits: [], error: res.reason };

  try {
    const data = JSON.parse(res.body) as {
      results?: Array<{ url?: string; title?: string; content?: string }>;
    };
    const hits: RawHit[] = [];
    for (const r of data.results ?? []) {
      const norm = r.url ? normalizeHitUrl(r.url) : null;
      if (!norm) continue;
      hits.push({
        url: norm,
        title: (r.title ?? "").trim(),
        snippet: (r.content ?? "").trim().slice(0, 400),
        provider: "tavily",
      });
    }
    return { hits };
  } catch {
    return { hits: [], error: "invalid_json" };
  }
}

type ProviderFn = (
  query: string,
  opts: SearchDiscussionOptions,
) => Promise<{ hits: RawHit[]; error?: string }>;

function resolveSearchApiKey(opts: SearchDiscussionOptions): string {
  return (
    opts.searchApiKey?.trim() ||
    (typeof process !== "undefined" ? process.env.SEARCH_API_KEY?.trim() : "") ||
    ""
  );
}

function resolveProviders(opts: SearchDiscussionOptions): Array<{
  name: string;
  run: ProviderFn;
}> {
  const providers: Array<{ name: string; run: ProviderFn }> = [
    { name: "hn_algolia", run: searchHnAlgolia },
    { name: "duckduckgo", run: searchDuckDuckGo },
  ];

  const key = resolveSearchApiKey(opts);
  if (key) {
    providers.push({
      name: "brave",
      run: (q, o) => searchBrave(q, key, o),
    });
    providers.push({
      name: "tavily",
      run: (q, o) => searchTavily(q, key, o),
    });
  }

  return providers;
}

async function fetchDiscussionPage(
  hit: RawHit,
  opts: SearchDiscussionOptions,
): Promise<DiscussionPage | null> {
  const result = await safeFetch(hit.url, opts);
  if (!result.ok) return null;
  const cleaned: CleanPageResult = cleanPage(result.body, result.finalUrl);
  return {
    url: cleaned.url,
    title: cleaned.title || hit.title,
    description: cleaned.description,
    text: cleaned.text,
    provider: hit.provider,
  };
}

/**
 * Search public discussion of a company's interview process.
 * Providers are optional and failure-tolerant; returns `pages: []` when nothing useful is found.
 */
export async function searchDiscussion(
  companyUrl: string,
  opts: SearchDiscussionOptions = {},
): Promise<SearchDiscussionResult> {
  const log: DiscussionLogEntry[] = [];
  const companyName = inferCompanyName({
    companyUrl,
    homepageTitle: opts.homepageTitle,
    ogSiteName: opts.ogSiteName,
    homepageHtml: opts.homepageHtml,
  });
  const queries = buildQueries(companyName);
  const maxPages = opts.maxPages ?? MAX_DISCUSSION_PAGES;

  if (!resolveSearchApiKey(opts)) {
    log.push({
      provider: "brave",
      status: "skipped",
      detail: "no_search_api_key",
    });
    log.push({
      provider: "tavily",
      status: "skipped",
      detail: "no_search_api_key",
    });
  }

  const providers = resolveProviders(opts);
  const collected: RawHit[] = [];
  const seenUrls = new Set<string>();

  for (const provider of providers) {
    for (const query of queries) {
      try {
        const { hits, error } = await provider.run(query, opts);
        if (error) {
          log.push({
            provider: provider.name,
            status: "error",
            query,
            detail: error,
          });
          continue;
        }
        const relevant = hits.filter((h) => mentionsCompany(h, companyName));
        for (const h of relevant) {
          if (seenUrls.has(h.url)) continue;
          seenUrls.add(h.url);
          collected.push(h);
        }
        if (relevant.length === 0) {
          log.push({
            provider: provider.name,
            status: "empty",
            query,
            detail: hits.length === 0 ? "no_hits" : "no_company_mention",
          });
        } else {
          log.push({
            provider: provider.name,
            status: "ok",
            query,
            detail: `${relevant.length}_hits`,
          });
        }
      } catch (err) {
        log.push({
          provider: provider.name,
          status: "error",
          query,
          detail: err instanceof Error ? err.message : "provider_threw",
        });
      }
    }
  }

  const pages: DiscussionPage[] = [];
  for (const hit of collected) {
    if (pages.length >= maxPages) break;
    try {
      const page = await fetchDiscussionPage(hit, opts);
      if (page) {
        // Re-check company mention in fetched body
        const hay = `${page.title} ${page.text} ${page.url}`.toLowerCase();
        if (hay.includes(companyName.toLowerCase())) {
          pages.push(page);
        } else {
          log.push({
            provider: hit.provider,
            status: "empty",
            detail: `fetched_but_no_mention:${hit.url}`,
          });
        }
      } else {
        log.push({
          provider: hit.provider,
          status: "error",
          detail: `fetch_failed:${hit.url}`,
        });
      }
    } catch (err) {
      log.push({
        provider: hit.provider,
        status: "error",
        detail: err instanceof Error ? err.message : "fetch_threw",
      });
    }
  }

  if (pages.length === 0) {
    log.push({
      provider: "searchDiscussion",
      status: "empty",
      detail: "no_discussion_found",
    });
  }

  return { pages, companyName, log };
}
