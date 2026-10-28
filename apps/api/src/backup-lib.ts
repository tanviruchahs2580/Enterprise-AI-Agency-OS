import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

import { openDatabase } from "./db.js";

export type DatabaseSummary = {
  path: string;
  bytes: number;
  schemaVersion: number;
  integrity: string;
  tenants: number;
  tokens: number;
  missions: number;
  tasks: number;
  events: number;
};

export type BackupResult = DatabaseSummary & {
  source: string;
  createdAt: string;
};

export type RestoreResult = DatabaseSummary & {
  backup: string;
  restoredTo: string;
  removedAfterDrill: boolean;
};

function tableCount(db: DatabaseSync, table: string): number {
  const exists = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .get(table);
  if (exists === undefined) return 0;
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number;
  };
  return Number(row.count);
}

export function inspectDatabase(
  databasePath: string,
  options: { readOnly?: boolean } = {},
): DatabaseSummary {
  const path = resolve(databasePath);
  const db = new DatabaseSync(path, {
    readOnly: options.readOnly ?? true,
    enableForeignKeyConstraints: true,
    timeout: 5000,
  });
  try {
    const integrityRows = db
      .prepare("PRAGMA integrity_check;")
      .all() as Array<{ integrity_check: string }>;
    const integrity = integrityRows.map((row) => row.integrity_check).join("; ");
    if (integrity !== "ok") {
      throw new Error(`Database integrity check failed: ${integrity}`);
    }
    const versionRow = db.prepare("PRAGMA user_version;").get() as
      | { user_version: number }
      | undefined;
    const schemaVersion = versionRow?.user_version ?? 0;
    return {
      path,
      bytes: statSync(path).size,
      schemaVersion,
      integrity,
      tenants: tableCount(db, "tenants"),
      tokens: tableCount(db, "api_tokens"),
      missions: tableCount(db, "missions"),
      tasks: tableCount(db, "tasks"),
      events: tableCount(db, "domain_events"),
    };
  } finally {
    db.close();
  }
}

export async function createBackup(
  sourcePath: string,
  outputDir: string,
  options: { keep?: number } = {},
): Promise<BackupResult> {
  const source = resolve(sourcePath);
  const dir = resolve(outputDir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = join(dir, `agency-${stamp}.db`);
  const db = openDatabase(source);
  try {
    await backup(db, target);
    chmodSync(target, 0o600);
  } finally {
    if (db.isOpen) db.close();
  }

  const summary = inspectDatabase(target);
  if (options.keep !== undefined) {
    if (!Number.isInteger(options.keep) || options.keep < 1) {
      throw new RangeError("Backup retention must be a positive integer");
    }
    pruneBackups(dir, options.keep, target);
  }
  return {
    ...summary,
    source,
    createdAt: new Date().toISOString(),
  };
}

function pruneBackups(dir: string, keep: number, currentTarget: string): void {
  const files = readdirSync(dir)
    .filter((name) => /^agency-.*\.db$/.test(name))
    .map((name) => {
      const path = join(dir, name);
      return { path, mtimeMs: statSync(path).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const file of files.slice(keep)) {
    if (file.path === currentTarget) continue;
    unlinkSync(file.path);
  }
}

export function restoreDrill(
  backupPath: string,
  destinationPath: string,
  options: { removeAfter?: boolean; expectedTenant?: string } = {},
): RestoreResult {
  const source = resolve(backupPath);
  const destination = resolve(destinationPath);
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  if (source === destination) {
    throw new Error("Restore destination must differ from the backup path");
  }

  const sourceSummary = inspectDatabase(source);
  copyFileSync(source, destination);
  const db = openDatabase(destination);
  if (db.isOpen) db.close();

  const summary = inspectDatabase(destination);
  for (const field of [
    "tenants",
    "tokens",
    "missions",
    "tasks",
    "events",
  ] as const) {
    if (summary[field] !== sourceSummary[field]) {
      throw new Error(
        `Restore verification failed: ${field} count changed from ${sourceSummary[field]} to ${summary[field]}`,
      );
    }
  }

  if (options.expectedTenant !== undefined) {
    const restored = new DatabaseSync(destination, {
      readOnly: true,
      enableForeignKeyConstraints: true,
    });
    try {
      const row = restored
        .prepare("SELECT id FROM tenants WHERE name = ?")
        .get(options.expectedTenant);
      if (row === undefined) {
        throw new Error(
          `Restore verification failed: tenant "${options.expectedTenant}" is missing`,
        );
      }
    } finally {
      restored.close();
    }
  }
  const removedAfterDrill = options.removeAfter ?? false;
  if (removedAfterDrill) {
    rmSync(destination, { force: true });
    rmSync(`${destination}-wal`, { force: true });
    rmSync(`${destination}-shm`, { force: true });
  }
  return {
    ...summary,
    backup: source,
    restoredTo: destination,
    removedAfterDrill,
  };
}
