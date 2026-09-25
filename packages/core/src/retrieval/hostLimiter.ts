const MIN_INTERVAL_MS = 500;

const lastRequestAt = new Map<string, number>();

/** ≥500 ms between requests to the same host (hostname, lowercased). */
export async function waitForHostSlot(hostname: string, now = Date.now()): Promise<void> {
  const key = hostname.toLowerCase();
  const last = lastRequestAt.get(key) ?? 0;
  const wait = MIN_INTERVAL_MS - (now - last);
  if (wait > 0) {
    await sleep(wait);
  }
  lastRequestAt.set(key, Date.now());
}

export function resetHostLimiter(): void {
  lastRequestAt.clear();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
