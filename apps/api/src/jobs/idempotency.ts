import { createHash } from "node:crypto";

/** Collapse whitespace so trivial JD edits don't defeat §10 duplicate detection. */
export function normalizeJd(jd: string): string {
  return jd.trim().replace(/\s+/g, " ");
}

/**
 * Canonical company URL for the idempotency key: lowercase host, strip hash,
 * drop a trailing slash on non-root paths.
 */
export function normalizeCompanyUrl(url: string): string {
  const u = new URL(url.trim());
  u.hash = "";
  u.hostname = u.hostname.toLowerCase();
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.slice(0, -1);
  }
  return u.href;
}

/** sha256(userId + normalised JD + normalised URL + days). */
export function computeIdempotencyKey(
  userId: string,
  jd: string,
  companyUrl: string,
  days: number,
): string {
  const payload = [
    userId,
    normalizeJd(jd),
    normalizeCompanyUrl(companyUrl),
    String(days),
  ].join("\n");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
