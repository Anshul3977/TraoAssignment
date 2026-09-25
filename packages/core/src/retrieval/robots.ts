import robotsParserModule from "robots-parser";

type RobotsRules = {
  isAllowed(url: string, ua?: string): boolean | undefined;
};

// CJS default export under NodeNext — normalise to a callable.
const robotsParser = robotsParserModule as unknown as (
  robotsUrl: string,
  body: string,
) => RobotsRules;

type RobotsCacheEntry = { robots: RobotsRules } | { missing: true };

const cache = new Map<string, RobotsCacheEntry>();

export const USER_AGENT =
  "PrepKitBot/1.0 (+https://github.com/prep-kit/interview-prep; research for interview prep kits)";

/** Clear cached robots.txt parsers (tests). */
export function resetRobotsCache(): void {
  cache.clear();
}

/**
 * Returns whether `url` is allowed by the origin's robots.txt.
 * Missing or unreadable robots.txt ⇒ allow (fail open for research).
 */
export async function isAllowedByRobots(
  url: URL,
  fetchRobotsBody: (robotsUrl: string) => Promise<string | null>,
): Promise<boolean> {
  const origin = url.origin;
  let entry = cache.get(origin);

  if (!entry) {
    const robotsUrl = new URL("/robots.txt", origin).href;
    const body = await fetchRobotsBody(robotsUrl);
    if (body === null) {
      entry = { missing: true };
    } else {
      entry = { robots: robotsParser(robotsUrl, body) };
    }
    cache.set(origin, entry);
  }

  if ("missing" in entry) return true;

  const allowed = entry.robots.isAllowed(url.href, USER_AGENT);
  // undefined ⇒ URL not covered / invalid for this robots — treat as allowed
  return allowed !== false;
}
