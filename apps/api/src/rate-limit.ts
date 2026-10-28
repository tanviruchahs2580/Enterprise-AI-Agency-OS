import { AppError } from "@agency/core";

export type RateLimitOptions = {
  max: number;
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

export class RateLimiter {
  readonly max: number;
  readonly windowMs: number;
  private readonly buckets = new Map<string, Bucket>();

  constructor(options: RateLimitOptions) {
    if (
      !Number.isInteger(options.max) ||
      options.max < 1 ||
      options.max > 100_000
    ) {
      throw new RangeError("Rate limit max must be an integer between 1 and 100000");
    }
    if (
      !Number.isInteger(options.windowMs) ||
      options.windowMs < 1_000 ||
      options.windowMs > 3_600_000
    ) {
      throw new RangeError(
        "Rate limit windowMs must be an integer between 1000 and 3600000",
      );
    }
    this.max = options.max;
    this.windowMs = options.windowMs;
  }

  consume(key: string, now = Date.now()): RateLimitResult {
    if (typeof key !== "string" || key === "") {
      throw new AppError("INTERNAL", "Rate limit key must be a non-empty string");
    }
    if (this.buckets.size >= 10_000) this.prune(now);

    const existing = this.buckets.get(key);
    if (existing === undefined || existing.resetAt <= now) {
      const resetAt = now + this.windowMs;
      this.buckets.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: this.max - 1, resetAt, retryAfterSeconds: 0 };
    }

    if (existing.count >= this.max) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: existing.resetAt,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((existing.resetAt - now) / 1000),
        ),
      };
    }

    existing.count += 1;
    return {
      allowed: true,
      remaining: this.max - existing.count,
      resetAt: existing.resetAt,
      retryAfterSeconds: 0,
    };
  }

  get size(): number {
    return this.buckets.size;
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
