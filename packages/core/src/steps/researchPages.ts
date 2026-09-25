/**
 * Minimal page shape consumed by LLM research steps.
 * Compatible with retrieval-lane `CrawledPage` / discussion snippets once merged —
 * defined here so this lane does not vendor retrieval sources.
 */
export type ResearchPage = {
  url: string;
  text: string;
  title?: string;
  description?: string;
};

/** Public discussion / search hit used by extractInterviewProcess. */
export type DiscussionHit = {
  /** Result URL when known (filtered into sources when non-empty). */
  url?: string;
  text: string;
  title?: string;
};

/** URLs that were actually fetched / provided as input pages. */
export function collectedUrls(
  pages: readonly ResearchPage[],
  extras: readonly DiscussionHit[] = [],
): Set<string> {
  const urls = new Set<string>();
  for (const p of pages) {
    if (p.url) urls.add(p.url);
  }
  for (const d of extras) {
    if (d.url) urls.add(d.url);
  }
  return urls;
}

/**
 * Keep only sources the model returned that match fetched input URLs.
 * Code owns citation — the model never decides which sources are cited.
 */
export function filterSourcesToFetched(
  claimed: readonly string[],
  fetched: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of claimed) {
    const trimmed = s.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    if (!fetched.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/** Default sources when the model cites nothing usable: the input page URLs in order. */
export function defaultSourcesFromPages(pages: readonly ResearchPage[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of pages) {
    if (!p.url || seen.has(p.url)) continue;
    seen.add(p.url);
    out.push(p.url);
  }
  return out;
}

export function pageHasUsableText(page: ResearchPage): boolean {
  return page.text.trim().length > 0;
}
