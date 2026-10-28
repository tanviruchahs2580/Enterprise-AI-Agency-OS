import { randomBytes } from "node:crypto";

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const TRACE_ID = /^[0-9a-f]{32}$/;
const ZERO_TRACE_ID = "0".repeat(32);
const ZERO_SPAN_ID = "0".repeat(16);

export type TraceContext = {
  traceId: string;
  spanId: string;
  traceparent: string;
};

export function resolveTraceContext(
  header: string | string[] | undefined,
  requestId: string,
): TraceContext {
  const value = Array.isArray(header) ? header[0] : header;
  const match =
    typeof value === "string" ? TRACEPARENT.exec(value.trim().toLowerCase()) : null;

  let traceId: string;
  let flags = "01";
  if (
    match !== null &&
    match[1] !== ZERO_TRACE_ID &&
    match[2] !== ZERO_SPAN_ID
  ) {
    traceId = match[1] as string;
    flags = match[3] as string;
  } else {
    const derived = requestId.replace(/-/g, "").toLowerCase();
    traceId = TRACE_ID.test(derived) ? derived : randomBytes(16).toString("hex");
  }

  const spanId = randomBytes(8).toString("hex");
  return {
    traceId,
    spanId,
    traceparent: `00-${traceId}-${spanId}-${flags}`,
  };
}
