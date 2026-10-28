import { createHash } from "node:crypto";

import { AppError } from "@agency/core";

import { withTransaction, type Database } from "./db.js";

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export type IdempotentResult<T> = {
  statusCode: number;
  body: T;
  replayed: boolean;
};

type IdempotencyRow = {
  operation: string;
  request_hash: string;
  status_code: number;
  response_json: string;
  expires_at: string;
};

export function parseIdempotencyKey(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw AppError.validation(
      "Idempotency-Key must be 1-128 characters using letters, digits, dot, underscore, colon, or hyphen",
    );
  }
  return value;
}

export function requestHash(
  operation: string,
  tokenId: string,
  body: unknown,
): string {
  const canonical = stableStringify(body);
  return createHash("sha256")
    .update(
      JSON.stringify({ operation, tokenId, body: canonical }),
      "utf8",
    )
    .digest("hex");
}

export function withIdempotency<T>(
  db: Database,
  tenantId: string,
  tokenId: string,
  key: string | undefined,
  operation: string,
  body: unknown,
  execute: () => { statusCode: number; body: T },
): IdempotentResult<T> {
  if (key === undefined) {
    return { ...execute(), replayed: false };
  }

  const hash = requestHash(operation, tokenId, body);
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString();

  return withTransaction(db, () => {
    db.prepare(
      "DELETE FROM idempotency_keys WHERE tenant_id = ? AND expires_at <= ?",
    ).run(tenantId, nowIso);

    const row = db
      .prepare(`
        SELECT operation, request_hash, status_code, response_json, expires_at
        FROM idempotency_keys
        WHERE tenant_id = ? AND key = ?
      `)
      .get(tenantId, key) as IdempotencyRow | undefined;

    if (row !== undefined) {
      if (row.operation !== operation || row.request_hash !== hash) {
        throw AppError.conflict(
          "Idempotency-Key was already used for a different request",
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.response_json);
      } catch {
        throw AppError.internal("Stored idempotency response is invalid");
      }
      return {
        statusCode: Number(row.status_code),
        body: parsed as T,
        replayed: true,
      };
    }

    const result = execute();
    if (
      !Number.isInteger(result.statusCode) ||
      result.statusCode < 200 ||
      result.statusCode > 299
    ) {
      throw AppError.internal("Idempotent operations must return a 2xx status");
    }
    db.prepare(`
      INSERT INTO idempotency_keys
        (tenant_id, key, operation, request_hash, status_code, response_json, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tenantId,
      key,
      operation,
      hash,
      result.statusCode,
      JSON.stringify(result.body),
      nowIso,
      expiresAt,
    );
    return { ...result, replayed: false };
  });
}

function stableStringify(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableStringify);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = stableStringify(record[key]);
    }
    return sorted;
  }
  return value;
}
