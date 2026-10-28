import { randomBytes } from "node:crypto";

import { AppError, newId } from "@agency/core";

import {
  ROLE_SCOPES,
  hashToken,
  isRole,
  type Role,
} from "./auth.js";
import type { Database } from "./db.js";

export type Tenant = {
  id: string;
  name: string;
  createdAt: string;
};

export type IssuedToken = {
  token: string;
  tokenId: string;
  tenantId: string;
  name: string;
  role: Role;
  scopes: readonly string[];
  createdAt: string;
  expiresAt: string | null;
};

const DEFAULT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type TenantRow = {
  id: string;
  name: string;
  created_at: string;
};

export function createTenant(db: Database, name: string): Tenant {
  const normalized = validateName(name, "Tenant name", 120);
  const id = newId();
  const createdAt = new Date().toISOString();
  db.prepare("INSERT INTO tenants (id, name, created_at) VALUES (?, ?, ?)").run(
    id,
    normalized,
    createdAt,
  );
  return { id, name: normalized, createdAt };
}

export function issueToken(
  db: Database,
  tenantId: string,
  options: {
    name: string;
    role: Role;
    expiresAt?: string | null;
  },
): IssuedToken {
  if (typeof tenantId !== "string" || tenantId.trim() === "") {
    throw AppError.validation("Tenant id must be a non-empty string");
  }
  if (!isRole(options.role)) {
    throw AppError.validation("Token role must be ADMIN, OPERATOR, or VIEWER");
  }
  const tokenName = validateName(options.name, "Token name", 120);
  const tenant = db
    .prepare("SELECT id FROM tenants WHERE id = ?")
    .get(tenantId);
  if (tenant === undefined) {
    throw AppError.notFound("Tenant");
  }

  const token = `eaa_${randomBytes(32).toString("base64url")}`;
  const tokenId = newId();
  const createdAt = new Date().toISOString();
  const scopes = ROLE_SCOPES[options.role];
  const expiresAt = resolveExpiresAt(options.expiresAt);

  db.prepare(`
    INSERT INTO api_tokens
      (id, tenant_id, name, role, scopes_json, token_hash, created_at, expires_at, revoked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `).run(
    tokenId,
    tenantId,
    tokenName,
    options.role,
    JSON.stringify(scopes),
    hashToken(token),
    createdAt,
    expiresAt,
  );

  return {
    token,
    tokenId,
    tenantId,
    name: tokenName,
    role: options.role,
    scopes,
    createdAt,
    expiresAt,
  };
}

export function revokeToken(
  db: Database,
  tenantId: string,
  tokenId: string,
): boolean {
  const result = db
    .prepare(`
      UPDATE api_tokens
      SET revoked_at = ?
      WHERE id = ? AND tenant_id = ? AND revoked_at IS NULL
    `)
    .run(new Date().toISOString(), tokenId, tenantId);
  return Number(result.changes) === 1;
}

export function getTenant(db: Database, tenantId: string): Tenant | undefined {
  const row = db
    .prepare("SELECT id, name, created_at FROM tenants WHERE id = ?")
    .get(tenantId) as TenantRow | undefined;
  return row === undefined
    ? undefined
    : { id: row.id, name: row.name, createdAt: row.created_at };
}

function resolveExpiresAt(value: string | null | undefined): string | null {
  if (value === null) return null;
  const date =
    value === undefined ? new Date(Date.now() + DEFAULT_TOKEN_TTL_MS) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw AppError.validation("Token expiry must be a valid ISO date or null");
  }
  return date.toISOString();
}

function validateName(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") {
    throw AppError.validation(`${label} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > max) {
    throw AppError.validation(`${label} must be between 1 and ${max} characters`);
  }
  return normalized;
}
