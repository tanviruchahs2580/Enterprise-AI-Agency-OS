import { isRetryable } from "./errors.js";

export type RetryOptions = {
  /** Total attempts including the first call. Defaults to 3. */
  maxAttempts?: number;
  /** Base delay in milliseconds. Defaults to 100. */
  baseDelayMs?: number;
  /** Maximum delay in milliseconds. Defaults to 10000. */
  maxDelayMs?: number;
  /** Apply full-jitter to each delay. Defaults to true. */
  jitter?: boolean;
  /** Decide whether a failure should be retried. Defaults to AppError.retryable. */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Override the timer, primarily for tests. */
  sleep?: (delayMs: number) => Promise<void>;
  /** Override randomness for deterministic tests. */
  random?: () => number;
};

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 100;
const DEFAULT_MAX_DELAY_MS = 10_000;

export function backoffDelay(
  attempt: number,
  options: RetryOptions = {},
): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RangeError("Retry attempt must be a positive integer");
  }
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0) {
    throw new RangeError("baseDelayMs must be a non-negative number");
  }
  if (!Number.isFinite(maxDelayMs) || maxDelayMs < baseDelayMs) {
    throw new RangeError("maxDelayMs must be a number >= baseDelayMs");
  }

  const exponential = Math.min(
    maxDelayMs,
    baseDelayMs * 2 ** Math.min(attempt - 1, 30),
  );
  if (options.jitter === false) return Math.round(exponential);

  const random = options.random ?? Math.random;
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError("random must return a number between 0 and 1");
  }
  return Math.round(exponential * value);
}

export async function retry<T>(
  operation: (attempt: number) => Promise<T> | T,
  options: RetryOptions = {},
): Promise<T> {
  if (typeof operation !== "function") {
    throw new TypeError("Retry operation must be a function");
  }
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) {
    throw new RangeError("maxAttempts must be an integer between 1 and 100");
  }
  const shouldRetry = options.shouldRetry ?? ((error: unknown) => isRetryable(error));
  const sleep =
    options.sleep ??
    ((delayMs: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, delayMs);
      }));

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !shouldRetry(error, attempt)) {
        throw error;
      }
      const delayMs = backoffDelay(attempt, options);
      if (delayMs > 0) await sleep(delayMs);
    }
  }
  throw lastError;
}

/**
 * Parse an HTTP Retry-After header (delta seconds or HTTP date) into
 * milliseconds from `now`. Returns undefined for absent or invalid values.
 */
export function parseRetryAfter(
  value: string | null | undefined,
  now = Date.now(),
): number | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;

  if (/^-?\d+$/.test(trimmed)) {
    if (trimmed.startsWith("-")) return undefined;
    const seconds = Number(trimmed);
    if (!Number.isSafeInteger(seconds)) return undefined;
    return seconds * 1000;
  }
  if (!/[A-Za-z]/.test(trimmed)) return undefined;

  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}
