import { parseArgs } from "node:util";

import { openDatabase } from "./db.js";
import { revokeToken } from "./provisioning.js";

const usage = `Usage:
  node dist/revoke.js --tenant-id <id> --token-id <id> [--db <path>]

Options:
  --db         SQLite database path (default: DATABASE_PATH or .data/agency.db)
  --tenant-id  Tenant id that owns the token (required)
  --token-id   Token id to revoke (required)`;

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
      "tenant-id": { type: "string" },
      "token-id": { type: "string" },
    },
    allowPositionals: false,
  }));
} catch (error) {
  fail(error instanceof Error ? error.message : "Invalid arguments");
}

if (values["tenant-id"] === undefined || values["token-id"] === undefined) {
  fail("--tenant-id and --token-id are required");
}

const databasePath =
  values.db ?? process.env.DATABASE_PATH ?? ".data/agency.db";
const db = openDatabase(databasePath);
try {
  const revoked = revokeToken(db, values["tenant-id"], values["token-id"]);
  if (!revoked) {
    console.error(
      "Token was not found, was already revoked, or belongs to another tenant",
    );
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ revoked: true, tokenId: values["token-id"] }));
  }
} finally {
  if (db.isOpen) db.close();
}
