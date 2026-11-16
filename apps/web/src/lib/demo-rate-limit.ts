/**
 * Best-effort, in-memory limiter for the public demo. State lives in one
 * server instance, so it bounds abuse per instance, not globally. The hard
 * ceiling is the LLM provider's free-tier quota, which cannot bill.
 */
export type DemoLimiter = {
  /** Returns null when allowed (and records the hit), else seconds to wait. */
  take(key: string, now?: number): number | null;
};

export function createDemoLimiter(opts: {
  max: number;
  windowMs: number;
}): DemoLimiter {
  const hits = new Map<string, number[]>();
  return {
    take(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < opts.windowMs);
      if (recent.length >= opts.max) {
        hits.set(key, recent);
        return Math.ceil((opts.windowMs - (now - recent[0]!)) / 1000);
      }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > 5000) {
        for (const [k, v] of hits) {
          if (v.every((t) => now - t >= opts.windowMs)) hits.delete(k);
        }
      }
      return null;
    },
  };
}

export const DEMO_LIMITS = {
  jdMaxChars: 6000,
  daysMin: 1,
  daysMax: 14,
} as const;

export type DemoInput = { jd: string; company_url: string; days: number };

/** Validate the demo request body. Returns an error message or the input. */
export function parseDemoInput(body: unknown): DemoInput | { error: string } {
  if (!body || typeof body !== "object") return { error: "Body must be JSON." };
  const b = body as Record<string, unknown>;
  const jd = typeof b.jd === "string" ? b.jd.trim() : "";
  const company_url = typeof b.company_url === "string" ? b.company_url.trim() : "";
  const days = typeof b.days === "number" ? b.days : Number(b.days);
  if (jd.length < 40) return { error: "Paste a job description (at least 40 characters)." };
  if (jd.length > DEMO_LIMITS.jdMaxChars) {
    return { error: `Job description is limited to ${DEMO_LIMITS.jdMaxChars} characters in the demo.` };
  }
  try {
    const u = new URL(company_url);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
  } catch {
    return { error: "Company URL must be a full http(s) URL." };
  }
  if (!Number.isInteger(days) || days < DEMO_LIMITS.daysMin || days > DEMO_LIMITS.daysMax) {
    return { error: `Days must be a whole number from ${DEMO_LIMITS.daysMin} to ${DEMO_LIMITS.daysMax}.` };
  }
  return { jd, company_url, days };
}
