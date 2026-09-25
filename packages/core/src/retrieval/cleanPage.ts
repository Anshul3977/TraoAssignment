import * as cheerio from "cheerio";

/** Soft cap on cleaned main text (~12k chars per T05). */
export const CLEAN_PAGE_TEXT_CAP = 12_000;

export type CleanPageLink = {
  text: string;
  href: string;
};

export type CleanPageResult = {
  url: string;
  title: string;
  description: string;
  links: CleanPageLink[];
  text: string;
};

type CheerioSelection = ReturnType<cheerio.CheerioAPI>;

function collapseWhitespace(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function metaDescription($: cheerio.CheerioAPI): string {
  const fromName = $('meta[name="description"]').attr("content");
  if (fromName) return collapseWhitespace(fromName);
  const fromOg = $('meta[property="og:description"]').attr("content");
  if (fromOg) return collapseWhitespace(fromOg);
  return "";
}

function absoluteUrl(href: string, pageUrl: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;
  // Skip non-navigational schemes that new URL would still accept
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("mailto:") ||
    lower.startsWith("tel:")
  ) {
    return null;
  }
  try {
    return new URL(trimmed, pageUrl).href;
  } catch {
    return null;
  }
}

function extractLinks($: cheerio.CheerioAPI, pageUrl: string): CleanPageLink[] {
  const links: CleanPageLink[] = [];
  const seen = new Set<string>();

  $("a[href]").each((_, el) => {
    const hrefAttr = $(el).attr("href");
    if (hrefAttr === undefined) return;
    const href = absoluteUrl(hrefAttr, pageUrl);
    if (!href) return;
    const text = collapseWhitespace($(el).text());
    const key = `${href}\0${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ text, href });
  });

  return links;
}

function stripChrome(root: CheerioSelection): void {
  root.find("script, style, noscript, svg, iframe").remove();
  root.find("nav, footer, form, header").remove();
  // role-based chrome often used instead of semantic tags
  root.find('[role="navigation"], [role="contentinfo"], [role="banner"]').remove();
}

function pickContentRoot($: cheerio.CheerioAPI): CheerioSelection {
  const main = $("main").first();
  if (main.length) return main;
  const article = $("article").first();
  if (article.length) return article;
  const body = $("body").first();
  if (body.length) return body;
  return $.root();
}

function insertBlockBreaks(root: CheerioSelection): void {
  root.find("br").replaceWith(" ");
  // Ensure adjacent block tags don't glue words ("body.</p><a>Team" → "body. Team")
  root
    .find("p, div, li, h1, h2, h3, h4, h5, h6, section, article, tr, td, th, blockquote, pre")
    .append(" ");
}

function extractMainText($: cheerio.CheerioAPI): string {
  const root = pickContentRoot($).clone();
  stripChrome(root);
  insertBlockBreaks(root);
  const text = collapseWhitespace(root.text());
  if (text.length <= CLEAN_PAGE_TEXT_CAP) return text;
  return text.slice(0, CLEAN_PAGE_TEXT_CAP);
}

/**
 * Parse HTML into title, description, links (pre-chrome strip), and capped main text.
 * Pure: never fetches; `pageUrl` is only used to absolutize relative hrefs.
 */
export function cleanPage(html: string, pageUrl: string): CleanPageResult {
  const $ = cheerio.load(html);
  const title = collapseWhitespace($("title").first().text());
  const description = metaDescription($);
  // Links must be collected BEFORE stripping nav/footer (T05).
  const links = extractLinks($, pageUrl);
  const text = extractMainText($);

  return {
    url: pageUrl,
    title,
    description,
    links,
    text,
  };
}
