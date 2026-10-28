import { describe, expect, it } from "vitest";

import {
  AppError,
  ERROR_STATUS,
  isAppError,
  isRetryable,
  type ErrorCode,
} from "../../packages/core/src/errors.js";

describe("AppError", () => {
  it("carries code, status, and retryability", () => {
    const error = new AppError("FORBIDDEN", "denied", 403, { resource: "mission" });

    expect(error.name).toBe("AppError");
    expect(error.code).toBe("FORBIDDEN");
    expect(error.status).toBe(403);
    expect(error.retryable).toBe(false);
    expect(error.details).toEqual({ resource: "mission" });
    expect(isAppError(error)).toBe(true);
  });

  it("assigns a consistent default status to every error code", () => {
    const codes = Object.keys(ERROR_STATUS) as ErrorCode[];

    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      const error = new AppError(code, "test");
      expect(error.status).toBe(ERROR_STATUS[code]);
      expect(error.status).toBeGreaterThanOrEqual(400);
      expect(error.status).toBeLessThanOrEqual(599);
    }
  });

  it("marks only transient provider failures as retryable", () => {
    const retryableCodes = new Set<ErrorCode>([
      "PROVIDER_UNAVAILABLE",
      "PROVIDER_TIMEOUT",
      "RATE_LIMITED",
      "CIRCUIT_OPEN",
      "SANDBOX_UNAVAILABLE",
    ]);

    for (const code of Object.keys(ERROR_STATUS) as ErrorCode[]) {
      expect(isRetryable(new AppError(code, "test"))).toBe(retryableCodes.has(code));
    }
  });

  it("rejects an invalid HTTP status", () => {
    expect(() => new AppError("INTERNAL", "test", 200)).toThrow(RangeError);
    expect(() => new AppError("INTERNAL", "test", 600)).toThrow(RangeError);
    expect(() => new AppError("INTERNAL", "test", 500.5)).toThrow(RangeError);
  });

  it("does not retry internal errors or unknown values", () => {
    expect(isRetryable(AppError.internal())).toBe(false);
    expect(isRetryable(new Error("unknown"))).toBe(false);
    expect(isRetryable("not-an-error")).toBe(false);
    expect(isAppError(new Error("plain"))).toBe(false);
  });

  it("builds an invalid transition error with scope details", () => {
    const error = AppError.invalidTransition("READY", "DONE", "task");

    expect(error.code).toBe("INVALID_TRANSITION");
    expect(error.status).toBe(409);
    expect(error.message).toBe("Invalid task transition: READY -> DONE");
    expect(error.details).toEqual({ from: "READY", to: "DONE", entity: "task" });
  });

  it("preserves an underlying cause", () => {
    const cause = new Error("socket closed");
    const error = AppError.internal("provider call failed", { attempt: 2 }, cause);

    expect(error.cause).toBe(cause);
    expect(error.status).toBe(500);
  });

  it("serializes a JSON payload without stack or cause", () => {
    const error = new AppError("VALIDATION_ERROR", "bad input", 400, { field: "name" });
    const json = error.toJSON();

    expect(json).toEqual({
      name: "AppError",
      code: "VALIDATION_ERROR",
      message: "bad input",
      status: 400,
      retryable: false,
      details: { field: "name" },
    });
    expect(Object.hasOwn(json, "stack")).toBe(false);
    expect(Object.hasOwn(json, "cause")).toBe(false);
  });

  it("serializes caller-provided details unchanged", () => {
    const json = new AppError("INTERNAL", "boom", 500, { note: "caller-controlled" }).toJSON();

    expect(json.details).toEqual({ note: "caller-controlled" });
  });

  it("omits undefined details from JSON", () => {
    const json = AppError.notFound("mission").toJSON();

    expect(Object.hasOwn(json, "details")).toBe(false);
    expect(json.status).toBe(404);
  });

  it("does not mark internal errors as retryable in JSON", () => {
    const json = AppError.internal("boom").toJSON();

    expect(json.code).toBe("INTERNAL");
    expect(json.retryable).toBe(false);
    expect(json.status).toBe(500);
  });
});
