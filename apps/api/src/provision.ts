import { parseArgs } from "node:util";

import { isRole } from "./auth.js";
import { openDatabase, withTransaction } from "./db.js";
import { createTenant, issueToken } from "./provisioning.js";

const usage = `Usage:
  node dist/provision.js --tenant <name> [options]

Options:
  --db <path>       SQLite database path (default: DATABASE_PATH or .data/agency.db)
  --tenant <name>   Tenant display name (required)
  --role <role>     ADMIN, OPERATOR, or VIEWER (default: OPERATOR)
  --token-name <n>  Token label (default: bootstrap)
  --ttl-days <n>    Token lifetime in days, 1-3650 (default: 30)

The plaintext token is printed once. Store it in a secret manager; it cannot be recovered.`;

function fail(message: string): never {
  console.error(message);
  console.error(usage);
  process.exit(1);
}

let values;
try {
  ({ values } = parseArgs({
    options: {
      db: { type: "string" },
      tenant: { type: "string" },
      role: { type: "string", default: "OPERATOR" },
      "token-name": { type: "string", default: "bootstrap" },
      "ttl-days": { type: "string", default: "30" },
    },
    allowPositionals: false,
  }));
} catch (error) {
  fail(error instanceof Error ? error.message : "Invalid arguments");
}

const tenantName = values.tenant;
if (tenantName === undefined || tenantName.trim() === "") {
  fail("--tenant is required");
}
if (values.role === undefined || !isRole(values.role.toUpperCase())) {
  fail("--role must be ADMIN, OPERATOR, or VIEWER");
}

const role = values.role.toUpperCase();
if (!isRole(role)) {
  fail("--role must be ADMIN, OPERATOR, or VIEWER");
}
const tokenName = values["token-name"] ?? "bootstrap";
const ttlDays = Number(values["ttl-days"]);
if (!Number.isInteger(ttlDays) || ttlDays < 1 || ttlDays > 3650) {
  fail("--ttl-days must be an integer between 1 and 3650");
}
const expiresAt = new Date(Date.now() + ttlDays * 86_400_000).toISOString();

const databasePath =
  values.db ?? process.env.DATABASE_PATH ?? ".data/agency.db";
const db = openDatabase(databasePath);

try {
  const { tenant, issued } = withTransaction(db, () => {
    const createdTenant = createTenant(db, tenantName);
    const createdToken = issueToken(db, createdTenant.id, {
      name: tokenName,
      role,
      expiresAt,
    });
    return { tenant: createdTenant, issued: createdToken };
  });
  console.log(
    JSON.stringify(
      {
        tenant: { id: tenant.id, name: tenant.name },
        token: {
          id: issued.tokenId,
          name: issued.name,
          role: issued.role,
          scopes: issued.scopes,
          expiresAt: issued.expiresAt,
          value: issued.token,
        },
        warning: "Store the token securely. It is not recoverable.",
      },
      null,
      2,
    ),
  );
} finally {
  if (db.isOpen) db.close();
}
