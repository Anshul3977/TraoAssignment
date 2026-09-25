/** Pure helpers for middleware / smoke tests (session cookie name from docs/API.md). */

export const SESSION_COOKIE = "session";

const PUBLIC_PATHS = new Set(["/login", "/register"]);

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

export type GuardDecision =
  | { action: "allow" }
  | { action: "redirect"; to: string };

/**
 * Decide auth redirects from cookie presence only.
 * JWT validity is enforced by the API (GET /auth/me and protected routes).
 */
export function decideAuthRedirect(
  pathname: string,
  hasSessionCookie: boolean,
): GuardDecision {
  if (!hasSessionCookie && !isPublicPath(pathname)) {
    const next = encodeURIComponent(pathname);
    return { action: "redirect", to: `/login?next=${next}` };
  }
  if (hasSessionCookie && isPublicPath(pathname)) {
    return { action: "redirect", to: "/" };
  }
  return { action: "allow" };
}
