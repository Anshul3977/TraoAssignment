/** Hiring / about keyword scoring for link ranking and page classification (T06). */

export const HIRING_SIGNALS = [
  "how we hire",
  "take-home",
  "careers",
  "jobs",
  "hiring",
  "interview",
  "recruit",
  "join",
  "handbook",
  "process",
  "onsite",
] as const;

export const ABOUT_SIGNALS = [
  "what we do",
  "about",
  "company",
  "mission",
  "team",
  "values",
  "culture",
] as const;

export const PENALTY_SIGNALS = [
  "login",
  "privacy",
  "terms",
  "cookie",
  "pricing",
  "legal",
  "assets",
] as const;

/**
 * Minimum content-derived score to classify as hiring or about (after fetch).
 * High enough that pages merely *mention* the absence of careers/hiring (e.g. quietco)
 * stay "other", while real hiring/about copy clears the bar.
 */
export const CONTENT_SCORE_THRESHOLD = 8;

const SIGNAL_WEIGHT = 2;
const PENALTY_WEIGHT = 3;
const FRAGMENT_PENALTY = 4;
const MAILTO_PENALTY = 10;

export type LinkScoreBreakdown = {
  hiring: number;
  about: number;
  penalty: number;
  /** Net score used for fetch priority: hiring + about - penalty. */
  total: number;
};

export type PageKind = "hiring" | "about" | "other";

function countPhrase(haystack: string, phrase: string): number {
  if (!phrase) return 0;
  let count = 0;
  let from = 0;
  while (from <= haystack.length - phrase.length) {
    const idx = haystack.indexOf(phrase, from);
    if (idx === -1) break;
    count += 1;
    from = idx + phrase.length;
  }
  return count;
}

function scoreSignals(haystack: string, signals: readonly string[]): number {
  const lower = haystack.toLowerCase();
  let score = 0;
  // Longer phrases first so "how we hire" is not double-counted poorly with "hire"
  const ordered = [...signals].sort((a, b) => b.length - a.length);
  let remaining = lower;
  for (const signal of ordered) {
    const n = countPhrase(remaining, signal);
    if (n === 0) continue;
    score += n * SIGNAL_WEIGHT;
    // Remove matched spans so shorter overlapping tokens don't re-score the same words
    remaining = remaining.split(signal).join(" ".repeat(signal.length));
  }
  return score;
}

function scorePenalties(haystack: string): number {
  const lower = haystack.toLowerCase();
  let penalty = 0;
  for (const signal of PENALTY_SIGNALS) {
    penalty += countPhrase(lower, signal) * PENALTY_WEIGHT;
  }
  return penalty;
}

function pathAndQuery(href: string): string {
  try {
    const u = new URL(href);
    return `${u.pathname}${u.search}`;
  } catch {
    return href;
  }
}

/**
 * Deterministic pre-fetch score from anchor text + URL path.
 * Penalties include fragment-only / hash URLs and mailto schemes.
 */
export function scoreLink(anchorText: string, href: string): LinkScoreBreakdown {
  let penalty = 0;
  const trimmed = href.trim();
  const lowerHref = trimmed.toLowerCase();

  if (lowerHref.startsWith("mailto:")) {
    penalty += MAILTO_PENALTY;
  }
  if (trimmed.startsWith("#") || (trimmed.includes("#") && !trimmed.split("#")[0])) {
    penalty += FRAGMENT_PENALTY;
  } else {
    try {
      const u = new URL(trimmed);
      if (u.hash && (!u.pathname || u.pathname === "/") && !u.search) {
        // hash-only navigation on same page — still penalize fragment
        penalty += FRAGMENT_PENALTY;
      } else if (u.hash) {
        penalty += Math.floor(FRAGMENT_PENALTY / 2);
      }
    } catch {
      // ignore
    }
  }

  const haystack = `${anchorText} ${pathAndQuery(href)}`;
  const hiring = scoreSignals(haystack, HIRING_SIGNALS);
  const about = scoreSignals(haystack, ABOUT_SIGNALS);
  penalty += scorePenalties(haystack);

  return {
    hiring,
    about,
    penalty,
    total: hiring + about - penalty,
  };
}

/** Post-fetch content score from title + main text (and optional description). */
export function scorePageContent(
  text: string,
  title = "",
  description = "",
): LinkScoreBreakdown {
  const haystack = `${title} ${description} ${text}`;
  const hiring = scoreSignals(haystack, HIRING_SIGNALS);
  const about = scoreSignals(haystack, ABOUT_SIGNALS);
  const penalty = scorePenalties(haystack);
  return {
    hiring,
    about,
    penalty,
    total: hiring + about - penalty,
  };
}

/**
 * Classify a fetched page using content scores.
 * Hiring wins when both clear the threshold; otherwise about, else other.
 */
export function classifyPage(scores: Pick<LinkScoreBreakdown, "hiring" | "about">): PageKind {
  const hiringOk = scores.hiring >= CONTENT_SCORE_THRESHOLD;
  const aboutOk = scores.about >= CONTENT_SCORE_THRESHOLD;
  if (hiringOk && aboutOk) {
    return scores.hiring >= scores.about ? "hiring" : "about";
  }
  if (hiringOk) return "hiring";
  if (aboutOk) return "about";
  return "other";
}

/** Sort candidates by score desc; stable by URL for determinism. */
export function rankLinks<T extends { score: number; url: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.url.localeCompare(b.url);
  });
}
