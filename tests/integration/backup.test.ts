import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createBackup,
  inspectDatabase,
  restoreDrill,
} from "../../apps/api/src/backup-lib.js";
import { openDatabase } from "../../apps/api/src/db.js";
import { createTenant, issueToken } from "../../apps/api/src/provisioning.js";
import { createMission } from "../../apps/api/src/repository.js";

describe("backup and restore drill", () => {
  it("creates a verified backup and restores it with matching row counts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agency-backup-"));
    const sourcePath = join(dir, "source.db");
    const db = openDatabase(sourcePath);
    try {
      const tenant = createTenant(db, "Backup Tenant");
      const token = issueToken(db, tenant.id, {
        name: "backup-token",
        role: "ADMIN",
      });
      createMission(
        db,
        tenant.id,
        { title: "Backup mission", description: "persist me" },
        { tokenId: token.tokenId, requestId: "backup-test" },
      );
    } finally {
      if (db.isOpen) db.close();
    }

    try {
      const backup = await createBackup(sourcePath, join(dir, "backups"));
      expect(backup.integrity).toBe("ok");
      expect(backup.schemaVersion).toBe(2);
      expect(backup.tenants).toBe(1);
      expect(backup.tokens).toBe(1);
      expect(backup.missions).toBe(1);
      expect(backup.events).toBe(1);
      expect(backup.bytes).toBeGreaterThan(0);
      expect(existsSync(backup.path)).toBe(true);

      const inspected = inspectDatabase(backup.path);
      expect(inspected.integrity).toBe("ok");
      expect(inspected.missions).toBe(1);

      const restored = restoreDrill(
        backup.path,
        join(dir, "restore", "restored.db"),
        { expectedTenant: "Backup Tenant" },
      );
      expect(restored.integrity).toBe("ok");
      expect(restored.removedAfterDrill).toBe(false);
      expect(restored.tenants).toBe(backup.tenants);
      expect(restored.tokens).toBe(backup.tokens);
      expect(restored.missions).toBe(backup.missions);
      expect(restored.events).toBe(backup.events);
      expect(existsSync(restored.restoredTo)).toBe(true);

      const ephemeral = restoreDrill(
        backup.path,
        join(dir, "restore", "ephemeral.db"),
        { removeAfter: true },
      );
      expect(ephemeral.removedAfterDrill).toBe(true);
      expect(existsSync(ephemeral.restoredTo)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    }
  });
});
