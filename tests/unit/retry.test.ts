import { describe, expect, it } from "vitest";

import {
  AppError,
  backoffDelay,
  parseRetryAfter,
  retry,
} from "../../packages/core/src/index.js";

describe("backoffDelay", () => {
  it("grows exponentially and caps at maxDelayMs", () => {
    expect(backoffDelay(1, { baseDelayMs: 100, jitter: false })).toBe(100);
    expect(backoffDelay(2, { baseDelayMs: 100, jitter: false })).toBe(200);
    expect(backoffDelay(3, { baseDelayMs: 100, jitter: false })).toBe(400);
    expect(
      backoffDelay(10, { baseDelayMs: 100, maxDelayMs: 300, jitter: false }),
    ).toBe(300);
  });

  it("applies bounded full jitter", () => {
    expect(
      backoffDelay(3, {
        baseDelayMs: 100,
        jitter: true,
        random: () => 0.5,
      }),
    ).toBe(200);
    expect(
      backoffDelay(3, {
        baseDelayMs: 100,
        jitter: true,
        random: () => 0,
      }),
    ).toBe(0);
    expect(
      backoffDelay(3, {
        baseDelayMs: 100,
        jitter: true,
        random: () => 1,
      }),
    ).toBe(400);
  });

  it("rejects invalid attempts and ranges", () => {
    expect(() => backoffDelay(0)).toThrow(RangeError);
    expect(() => backoffDelay(1.5)).toThrow(RangeError);
    expect(() => backoffDelay(1, { baseDelayMs: -1 })).toThrow(RangeError);
    expect(() =>
      backoffDelay(1, { baseDelayMs: 100, maxDelayMs: 50 }),
    ).toThrow(RangeError);
    expect(() =>
      backoffDelay(1, { jitter: true, random: () => 2 }),
    ).toThrow(RangeError);
  });
});

describe("retry", () => {
  it("retries retryable failures and returns the successful result", async () => {
    const delays: number[] = [];
    const attempts: number[] = [];
    const result = await retry(
      (attempt) => {
        attempts.push(attempt);
        if (attempt < 3) throw AppError.providerUnavailable();
        return "ok";
      },
      {
        maxAttempts: 3,
        baseDelayMs: 10,
        jitter: false,
        sleep: async (delay) => {
          delays.push(delay);
        },
      },
    );

    expect(result).toBe("ok");
    expect(attempts).toEqual([1, 2, 3]);
    expect(delays).toEqual([10, 20]);
  });

  it("does not retry non-retryable errors", async () => {
    let attempts = 0;
    let sleeps = 0;
    await expect(
      retry(
        () => {
          attempts += 1;
          throw AppError.validation("bad input");
        },
        {
          sleep: async () => {
            sleeps += 1;
          },
        },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(attempts).toBe(1);
    expect(sleeps).toBe(0);
  });

  it("supports a custom retry predicate", async () => {
    let attempts = 0;
    const result = await retry(
      () => {
        attempts += 1;
        if (attempts === 1) throw new Error("transient");
        return attempts;
      },
      {
        maxAttempts: 2,
        shouldRetry: (error) =>
          error instanceof Error && error.message === "transient",
        sleep: async () => undefined,
      },
    );
    expect(result).toBe(2);
  });

  it("throws the last error after exhausting attempts", async () => {
    let attempts = 0;
    await expect(
      retry(
        () => {
          attempts += 1;
          throw AppError.rateLimited("slow down", { retryAfterSeconds: 1 });
        },
        { maxAttempts: 2, sleep: async () => undefined },
      ),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(attempts).toBe(2);
  });

  it("validates options and operation type", async () => {
    await expect(
      retry(() => "ok", { maxAttempts: 0 }),
    ).rejects.toThrow(RangeError);
    await expect(
      retry(() => "ok", { maxAttempts: 101 }),
    ).rejects.toThrow(RangeError);
    await expect(
      retry(null as unknown as () => string),
    ).rejects.toThrow(TypeError);
  });
});

describe("parseRetryAfter", () => {
  it("parses delta seconds", () => {
    expect(parseRetryAfter("5")).toBe(5_000);
    expect(parseRetryAfter(" 0 ")).toBe(0);
  });

  it("parses HTTP dates relative to now", () => {
    const now = Date.parse("2026-10-27T00:00:00.000Z");
    expect(parseRetryAfter("Tue, 27 Oct 2026 00:00:10 GMT", now)).toBe(10_000);
    expect(parseRetryAfter("Tue, 27 Oct 2026 00:00:00 GMT", now)).toBe(0);
  });

  it("returns undefined for missing or invalid values", () => {
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("")).toBeUndefined();
    expect(parseRetryAfter("-1")).toBeUndefined();
    expect(parseRetryAfter("soon")).toBeUndefined();
  });
});
