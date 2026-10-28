import { join } from "node:path";
import { parseArgs } from "node:util";

import { restoreDrill } from "./backup-lib.js";

const usage = `Usage:
  node dist/restore-drill.js --backup <path> [options]

Options:
  --backup <path>     Backup file to restore (required)
  --to <path>         Restore destination (default: .tmp/restore-<timestamp>.db)
  --expect-tenant <n> Verify a tenant name exists after restore
  --keep              Keep the restored database (default: remove temporary drill copy)

The drill copies the backup, opens the restored database, verifies integrity,
schema version, and row counts, then removes the temporary copy unless --keep is set.`;

function fail(message: string): never {
  console.error(message);
  console.error(usage);
  process.exit(1);
}

let values;
try {
  ({ values } = parseArgs({
    options: {
      backup: { type: "string" },
      to: { type: "string" },
      "expect-tenant": { type: "string" },
      keep: { type: "boolean", default: false },
    },
    allowPositionals: false,
  }));
} catch (error) {
  fail(error instanceof Error ? error.message : "Invalid arguments");
}

const backupPath = values.backup;
if (backupPath === undefined || backupPath.trim() === "") {
  fail("--backup is required");
}
const destination =
  values.to ??
  join(
    ".tmp",
    `restore-${new Date().toISOString().replace(/[:.]/g, "-")}.db`,
  );
const removeAfter = values.to === undefined && values.keep !== true;

try {
  const result = restoreDrill(backupPath, destination, {
    removeAfter,
    expectedTenant: values["expect-tenant"],
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Restore drill failed");
  process.exit(1);
}
