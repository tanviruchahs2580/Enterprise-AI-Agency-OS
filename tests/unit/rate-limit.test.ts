import { describe, expect, it } from "vitest";

import { RateLimiter } from "../../apps/api/src/rate-limit.js";

describe("RateLimiter", () => {
  it("allows up to max requests and reports remaining capacity", () => {
    const limiter = new RateLimiter({ max: 2, windowMs: 1_000 });
    const start = 1_000_000;
    expect(limiter.consume("token-a", start)).toMatchObject({
      allowed: true,
      remaining: 1,
      retryAfterSeconds: 0,
    });
    expect(limiter.consume("token-a", start + 10)).toMatchObject({
      allowed: true,
      remaining: 0,
    });
    expect(limiter.consume("token-a", start + 20)).toMatchObject({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 1,
    });
  });

  it("resets a bucket after the window and isolates keys", () => {
    const limiter = new RateLimiter({ max: 1, windowMs: 1_000 });
    const start = 5_000;
    expect(limiter.consume("a", start).allowed).toBe(true);
    expect(limiter.consume("b", start).allowed).toBe(true);
    expect(limiter.consume("a", start + 999).allowed).toBe(false);
    expect(limiter.consume("a", start + 1_000).allowed).toBe(true);
    expect(limiter.size).toBe(2);
  });

  it("validates configuration and keys", () => {
    expect(() => new RateLimiter({ max: 0, windowMs: 1_000 })).toThrow(
      RangeError,
    );
    expect(() => new RateLimiter({ max: 1, windowMs: 999 })).toThrow(RangeError);
    expect(() => new RateLimiter({ max: 1, windowMs: 3_600_001 })).toThrow(
      RangeError,
    );
    const limiter = new RateLimiter({ max: 1, windowMs: 1_000 });
    expect(() => limiter.consume("")).toThrow();
  });
});
