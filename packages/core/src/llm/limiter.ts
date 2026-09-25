/**
 * Sliding-window token-per-minute + request-per-minute limiter.
 * Shared process-wide via getSharedLimiter(); estimate tokens = chars/4.
 */

export type SleepFn = (ms: number) => Promise<void>;
export type NowFn = () => number;

export type LimiterOptions = {
  requestsPerMinute: number;
  tokensPerMinute: number;
  /** Window length; default 60_000 ms. */
  windowMs?: number;
  now?: NowFn;
  sleep?: SleepFn;
};

type Event = { at: number; tokens: number };

const DEFAULT_WINDOW_MS = 60_000;

/** chars/4 — coarse but stable for budgeting free-tier TPM. */
export function estimateTokens(...parts: string[]): number {
  let chars = 0;
  for (const p of parts) chars += p.length;
  return Math.max(1, Math.ceil(chars / 4));
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TokenRequestLimiter {
  readonly requestsPerMinute: number;
  readonly tokensPerMinute: number;
  readonly windowMs: number;
  private readonly now: NowFn;
  private readonly sleep: SleepFn;
  private events: Event[] = [];
  /** Serialise acquires so concurrent callers don't race the window. */
  private chain: Promise<void> = Promise.resolve();

  constructor(opts: LimiterOptions) {
    if (opts.requestsPerMinute < 1) throw new Error("requestsPerMinute must be >= 1");
    if (opts.tokensPerMinute < 1) throw new Error("tokensPerMinute must be >= 1");
    this.requestsPerMinute = opts.requestsPerMinute;
    this.tokensPerMinute = opts.tokensPerMinute;
    this.windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  /** Wait until one request of `estimatedTokens` fits in the sliding window, then record it. */
  acquire(estimatedTokens: number): Promise<void> {
    const tokens = Math.max(1, Math.ceil(estimatedTokens));
    const run = this.chain.then(() => this.waitAndRecord(tokens));
    // Keep the chain alive even if a waiter rejects (shouldn't, but don't stall).
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Test helper: current usage inside the window. */
  snapshot(): { requests: number; tokens: number } {
    this.prune(this.now());
    let tokens = 0;
    for (const e of this.events) tokens += e.tokens;
    return { requests: this.events.length, tokens };
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.events.length > 0 && (this.events[0]?.at ?? 0) <= cutoff) {
      this.events.shift();
    }
  }

  private usage(): { requests: number; tokens: number; oldestAt: number | undefined } {
    let tokens = 0;
    for (const e of this.events) tokens += e.tokens;
    return {
      requests: this.events.length,
      tokens,
      oldestAt: this.events[0]?.at,
    };
  }

  private async waitAndRecord(tokens: number): Promise<void> {
    if (tokens > this.tokensPerMinute) {
      // Single request larger than the budget: still gate to 1 req / window after prior clears.
      // Cap recorded tokens at tpm so the window can recover.
      tokens = this.tokensPerMinute;
    }

    for (;;) {
      const now = this.now();
      this.prune(now);
      const { requests, tokens: used, oldestAt } = this.usage();
      const rpmOk = requests < this.requestsPerMinute;
      const tpmOk = used + tokens <= this.tokensPerMinute;
      if (rpmOk && tpmOk) {
        this.events.push({ at: now, tokens });
        return;
      }
      // Sleep until the oldest event exits the window (plus 1ms).
      const waitMs =
        oldestAt === undefined ? this.windowMs : Math.max(1, oldestAt + this.windowMs - now + 1);
      await this.sleep(waitMs);
    }
  }
}

/** Conservative defaults aimed at Gemini free-tier RPM/TPM headroom. */
export const DEFAULT_LIMITER_OPTIONS: LimiterOptions = {
  // Free-tier generate_content often caps near 20 RPM; leave headroom for retries.
  requestsPerMinute: 8,
  tokensPerMinute: 250_000,
};

let sharedLimiter: TokenRequestLimiter | undefined;

export function getSharedLimiter(overrides?: Partial<LimiterOptions>): TokenRequestLimiter {
  if (!sharedLimiter) {
    sharedLimiter = new TokenRequestLimiter({ ...DEFAULT_LIMITER_OPTIONS, ...overrides });
  }
  return sharedLimiter;
}

/** Reset the process-wide limiter (tests). */
export function resetSharedLimiter(): void {
  sharedLimiter = undefined;
}

export function setSharedLimiter(limiter: TokenRequestLimiter): void {
  sharedLimiter = limiter;
}
