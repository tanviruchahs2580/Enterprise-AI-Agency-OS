import { parseArgs } from "node:util";

import { createBackup } from "./backup-lib.js";

const usage = `Usage:
  node dist/backup.js [options]

Options:
  --db <path>   SQLite database path (default: DATABASE_PATH or .data/agency.db)
  --out <dir>   Backup directory (default: backups)
  --keep <n>    Keep only the newest n backups in the directory

The backup is verified with PRAGMA integrity_check before the command succeeds.`;

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
      out: { type: "string" },
      keep: { type: "string" },
    },
    allowPositionals: false,
  }));
} catch (error) {
  fail(error instanceof Error ? error.message : "Invalid arguments");
}

const databasePath = values.db ?? process.env.DATABASE_PATH ?? ".data/agency.db";
const outputDir = values.out ?? "backups";
const keep = values.keep === undefined ? undefined : Number(values.keep);
if (keep !== undefined && (!Number.isInteger(keep) || keep < 1)) {
  fail("--keep must be a positive integer");
}

try {
  const result = await createBackup(databasePath, outputDir, { keep });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Backup failed");
  process.exit(1);
}
