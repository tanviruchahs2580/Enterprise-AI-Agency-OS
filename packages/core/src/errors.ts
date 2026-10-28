export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_TRANSITION"
  | "RATE_LIMITED"
  | "BUDGET_EXCEEDED"
  | "APPROVAL_REQUIRED"
  | "DESTRUCTIVE_BLOCKED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_TIMEOUT"
  | "CIRCUIT_OPEN"
  | "SANDBOX_UNAVAILABLE"
  | "DEPENDENCY_FAILED"
  | "CYCLE_DETECTED"
  | "LOOP_LIMIT"
  | "INTEGRATION_ERROR"
  | "INTERNAL";

export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_TRANSITION: 409,
  RATE_LIMITED: 429,
  BUDGET_EXCEEDED: 402,
  APPROVAL_REQUIRED: 403,
  DESTRUCTIVE_BLOCKED: 403,
  PROVIDER_UNAVAILABLE: 503,
  PROVIDER_TIMEOUT: 504,
  CIRCUIT_OPEN: 503,
  SANDBOX_UNAVAILABLE: 503,
  DEPENDENCY_FAILED: 502,
  CYCLE_DETECTED: 409,
  LOOP_LIMIT: 429,
  INTEGRATION_ERROR: 502,
  INTERNAL: 500,
};

const RETRYABLE: ReadonlySet<ErrorCode> = new Set([
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_TIMEOUT",
  "RATE_LIMITED",
  "CIRCUIT_OPEN",
  "SANDBOX_UNAVAILABLE",
]);

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    status?: number,
    details?: unknown,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    const resolvedStatus = status ?? ERROR_STATUS[code] ?? 500;
    if (
      !Number.isInteger(resolvedStatus) ||
      resolvedStatus < 400 ||
      resolvedStatus > 599
    ) {
      throw new RangeError(`Invalid HTTP status ${resolvedStatus} for ${code}`);
    }
    this.name = "AppError";
    this.code = code;
    this.retryable = RETRYABLE.has(code);
    this.status = resolvedStatus;
    this.details = details;
  }

  static validation(message: string, details?: unknown) {
    return new AppError("VALIDATION_ERROR", message, 400, details);
  }
  static unauthenticated(message = "Authentication required") {
    return new AppError("UNAUTHENTICATED", message, 401);
  }
  static forbidden(message = "Permission denied", details?: unknown) {
    return new AppError("FORBIDDEN", message, 403, details);
  }
  static notFound(entity = "Resource") {
    return new AppError("NOT_FOUND", `${entity} not found`, 404);
  }
  static conflict(message: string, details?: unknown) {
    return new AppError("CONFLICT", message, 409, details);
  }
  static rateLimited(message = "Rate limit exceeded", details?: unknown) {
    return new AppError("RATE_LIMITED", message, 429, details);
  }
  static budgetExceeded(message = "Budget exceeded", details?: unknown) {
    return new AppError("BUDGET_EXCEEDED", message, 402, details);
  }
  static approvalRequired(message = "Approval required", details?: unknown) {
    return new AppError("APPROVAL_REQUIRED", message, 403, details);
  }
  static destructiveBlocked(message = "Destructive action blocked", details?: unknown) {
    return new AppError("DESTRUCTIVE_BLOCKED", message, 403, details);
  }
  static providerUnavailable(message = "Provider unavailable", details?: unknown) {
    return new AppError("PROVIDER_UNAVAILABLE", message, 503, details);
  }
  static providerTimeout(message = "Provider timed out", details?: unknown) {
    return new AppError("PROVIDER_TIMEOUT", message, 504, details);
  }
  static internal(message = "Internal error", details?: unknown, cause?: unknown) {
    return new AppError("INTERNAL", message, 500, details, cause);
  }
  static invalidTransition(from: string, to: string, entity: string) {
    return new AppError(
      "INVALID_TRANSITION",
      `Invalid ${entity} transition: ${from} -> ${to}`,
      409,
      { from, to, entity },
    );
  }

  toJSON(): {
    name: string;
    code: ErrorCode;
    message: string;
    status: number;
    retryable: boolean;
    details?: unknown;
  } {
    const base = {
      name: this.name,
      code: this.code,
      message: this.message,
      status: this.status,
      retryable: this.retryable,
    };
    return this.details === undefined ? base : { ...base, details: this.details };
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export function isRetryable(err: unknown): boolean {
  return err instanceof AppError ? err.retryable : false;
}
