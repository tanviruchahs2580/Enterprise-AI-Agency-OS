import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Database = DatabaseSync;

const SCHEMA_VERSION = 3;

export function openDatabase(databasePath: string): Database {
  if (typeof databasePath !== "string" || databasePath.trim() === "") {
    throw new Error("Database path must be a non-empty string");
  }

  const resolvedPath =
    databasePath === ":memory:" ? databasePath : resolve(databasePath);
  if (resolvedPath !== ":memory:") {
    mkdirSync(dirname(resolvedPath), { recursive: true, mode: 0o700 });
  }

  const db = new DatabaseSync(resolvedPath, {
    enableForeignKeyConstraints: true,
    timeout: 5000,
    readBigInts: false,
  });

  try {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA synchronous = FULL;");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec("PRAGMA busy_timeout = 5000;");
    db.exec("PRAGMA trusted_schema = OFF;");
    migrate(db);
    return db;
  } catch (error) {
    if (db.isOpen) db.close();
    throw error;
  }
}

export type TransactionOptions = {
  reuseExisting?: boolean;
};

export function withTransaction<T>(
  db: Database,
  operation: () => T,
  options: TransactionOptions = {},
): T {
  if (db.isTransaction) {
    if (options.reuseExisting === true) return operation();
    throw new Error("Nested database transactions are not supported");
  }

  db.exec("BEGIN IMMEDIATE;");
  try {
    const result = operation();
    db.exec("COMMIT;");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // Preserve the original failure.
    }
    throw error;
  }
}

function migrate(db: Database): void {
  const row = db.prepare("PRAGMA user_version;").get() as
    | { user_version: number }
    | undefined;
  const current = row?.user_version ?? 0;
  if (!Number.isInteger(current) || current < 0) {
    throw new Error("Database schema version is invalid");
  }
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${current} is newer than supported version ${SCHEMA_VERSION}`,
    );
  }
  if (current === SCHEMA_VERSION) return;

  db.exec("BEGIN IMMEDIATE;");
  try {
    if (current < 1) {
      db.exec(`
        CREATE TABLE tenants (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
          created_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE api_tokens (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
          role TEXT NOT NULL CHECK (role IN ('ADMIN', 'OPERATOR', 'VIEWER')),
          scopes_json TEXT NOT NULL CHECK (json_valid(scopes_json)),
          token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
          created_at TEXT NOT NULL,
          revoked_at TEXT
        ) STRICT;

        CREATE INDEX idx_api_tokens_tenant
          ON api_tokens (tenant_id, revoked_at);

        CREATE TABLE counters (
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 32),
          value INTEGER NOT NULL CHECK (value >= 1),
          PRIMARY KEY (tenant_id, name)
        ) STRICT;

        CREATE TABLE missions (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          code TEXT NOT NULL,
          title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
          description TEXT NOT NULL CHECK (length(description) <= 4000),
          state TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (tenant_id, code),
          UNIQUE (tenant_id, id)
        ) STRICT;

        CREATE INDEX idx_missions_tenant_created
          ON missions (tenant_id, created_at DESC, id DESC);
        CREATE INDEX idx_missions_tenant_state
          ON missions (tenant_id, state);

        CREATE TABLE tasks (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          mission_id TEXT NOT NULL,
          code TEXT NOT NULL,
          title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
          description TEXT NOT NULL CHECK (length(description) <= 4000),
          state TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (tenant_id, code),
          FOREIGN KEY (tenant_id, mission_id)
            REFERENCES missions (tenant_id, id) ON DELETE CASCADE
        ) STRICT;

        CREATE INDEX idx_tasks_tenant_mission_created
          ON tasks (tenant_id, mission_id, created_at DESC, id DESC);

        CREATE TABLE domain_events (
          event_id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          aggregate_type TEXT NOT NULL,
          aggregate_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          schema_version INTEGER NOT NULL CHECK (schema_version = 1),
          occurred_at TEXT NOT NULL,
          actor_type TEXT NOT NULL,
          actor_id TEXT,
          correlation_id TEXT,
          causation_id TEXT,
          payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
        ) STRICT;

        CREATE INDEX idx_events_tenant_aggregate
          ON domain_events (tenant_id, aggregate_type, aggregate_id, occurred_at, event_id);
        CREATE INDEX idx_events_tenant_occurred
          ON domain_events (tenant_id, occurred_at, event_id);
      `);
    }

    if (current < 2) {
      db.exec(`
        ALTER TABLE api_tokens ADD COLUMN expires_at TEXT;

        CREATE INDEX idx_api_tokens_expires
          ON api_tokens (expires_at);

        CREATE TABLE idempotency_keys (
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          key TEXT NOT NULL CHECK (length(key) BETWEEN 1 AND 128),
          operation TEXT NOT NULL CHECK (length(operation) BETWEEN 1 AND 120),
          request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
          status_code INTEGER NOT NULL CHECK (status_code BETWEEN 200 AND 299),
          response_json TEXT NOT NULL CHECK (json_valid(response_json)),
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          PRIMARY KEY (tenant_id, key)
        ) STRICT;

        CREATE INDEX idx_idempotency_expires
          ON idempotency_keys (expires_at);
      `);
    }

    if (current < 3) {
      db.exec(`
        CREATE TABLE domain_events_v3 (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id TEXT NOT NULL UNIQUE,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          aggregate_type TEXT NOT NULL,
          aggregate_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          schema_version INTEGER NOT NULL CHECK (schema_version = 1),
          occurred_at TEXT NOT NULL,
          actor_type TEXT NOT NULL,
          actor_id TEXT,
          correlation_id TEXT,
          causation_id TEXT,
          payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
        ) STRICT;

        INSERT INTO domain_events_v3
          (event_id, tenant_id, aggregate_type, aggregate_id, event_type,
           schema_version, occurred_at, actor_type, actor_id, correlation_id,
           causation_id, payload_json)
        SELECT
          event_id, tenant_id, aggregate_type, aggregate_id, event_type,
          schema_version, occurred_at, actor_type, actor_id, correlation_id,
          causation_id, payload_json
        FROM domain_events
        ORDER BY rowid;

        DROP TABLE domain_events;
        ALTER TABLE domain_events_v3 RENAME TO domain_events;

        CREATE INDEX idx_events_tenant_aggregate
          ON domain_events (tenant_id, aggregate_type, aggregate_id, occurred_at, seq);
        CREATE INDEX idx_events_tenant_occurred
          ON domain_events (tenant_id, occurred_at, seq);
      `);
    }

    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
    db.exec("COMMIT;");
  } catch (error) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // Preserve the original failure.
    }
    throw error;
  }
}
