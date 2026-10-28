import { createHash } from "node:crypto";

import { AppError } from "@agency/core";

import type { Database } from "./db.js";

export const SCOPES = [
  "missions:read",
  "missions:write",
  "tasks:read",
  "tasks:write",
  "events:read",
] as const;

export type Scope = (typeof SCOPES)[number];

export const ROLES = ["ADMIN", "OPERATOR", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_SCOPES: Readonly<Record<Role, readonly Scope[]>> = Object.freeze({
  ADMIN: SCOPES,
  OPERATOR: SCOPES,
  VIEWER: ["missions:read", "tasks:read", "events:read"],
});

const SCOPE_VALUES: ReadonlySet<string> = new Set(SCOPES);
const ROLE_VALUES: ReadonlySet<string> = new Set(ROLES);
export const TOKEN_PATTERN = /^eaa_[A-Za-z0-9_-]{43}$/;

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && ROLE_VALUES.has(value);
}

export function isScope(value: unknown): value is Scope {
  return typeof value === "string" && SCOPE_VALUES.has(value);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function parseStoredScopes(json: string): ReadonlySet<Scope> {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("Stored token scopes are not valid JSON");
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Stored token scopes must be a non-empty array");
  }
  const scopes = new Set<Scope>();
  for (const entry of value) {
    if (!isScope(entry)) {
      throw new Error(`Stored token contains an unknown scope: ${String(entry)}`);
    }
    scopes.add(entry);
  }
  return scopes;
}

export type AuthContext = {
  tokenId: string;
  tokenName: string;
  tenantId: string;
  tenantName: string;
  role: Role;
  scopes: ReadonlySet<Scope>;
  expiresAt: string | null;
};

type TokenRow = {
  token_id: string;
  token_name: string;
  tenant_id: string;
  tenant_name: string;
  role: string;
  scopes_json: string;
  expires_at: string | null;
};

export function authenticate(
  db: Database,
  authorization: string | undefined,
): AuthContext {
  if (authorization === undefined) {
    throw AppError.unauthenticated();
  }
  if (!authorization.startsWith("Bearer ")) {
    throw AppError.unauthenticated("Bearer token required");
  }
  const token = authorization.slice("Bearer ".length);
  if (!TOKEN_PATTERN.test(token)) {
    throw AppError.unauthenticated("Invalid bearer token");
  }

  const row = db
    .prepare(`
      SELECT
        t.id AS token_id,
        t.name AS token_name,
        t.tenant_id,
        t.role,
        t.scopes_json,
        t.expires_at,
        ten.name AS tenant_name
      FROM api_tokens t
      JOIN tenants ten ON ten.id = t.tenant_id
      WHERE t.token_hash = ?
        AND t.revoked_at IS NULL
        AND (t.expires_at IS NULL OR t.expires_at > ?)
    `)
    .get(hashToken(token), new Date().toISOString()) as TokenRow | undefined;

  if (row === undefined) {
    throw AppError.unauthenticated("Invalid bearer token");
  }
  if (!isRole(row.role)) {
    throw AppError.internal("Stored token role is invalid");
  }

  let scopes: ReadonlySet<Scope>;
  try {
    scopes = parseStoredScopes(row.scopes_json);
  } catch {
    throw AppError.internal("Stored token scopes are invalid");
  }
  return {
    tokenId: row.token_id,
    tokenName: row.token_name,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    role: row.role,
    scopes,
    expiresAt: row.expires_at,
  };
}

export function requireScope(auth: AuthContext, scope: Scope): void {
  if (!auth.scopes.has(scope)) {
    throw AppError.forbidden(`Missing required scope: ${scope}`);
  }
}
