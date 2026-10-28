import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hashToken } from "../../apps/api/src/auth.js";
import { openDatabase, type Database } from "../../apps/api/src/db.js";
import {
  createTenant,
  issueToken,
  revokeToken,
  type IssuedToken,
  type Tenant,
} from "../../apps/api/src/provisioning.js";
import { buildServer } from "../../apps/api/src/server.js";

type Fixture = {
  dir: string;
  dbPath: string;
  db: Database;
  app: FastifyInstance;
  tenantA: Tenant;
  tenantB: Tenant;
  admin: IssuedToken;
  viewer: IssuedToken;
  other: IssuedToken;
};

type ErrorBody = {
  error: {
    code: string;
    status: number;
    message: string;
    requestId: string;
    details?: unknown;
  };
};

type MissionBody = {
  mission: {
    id: string;
    code: string;
    title: string;
    description: string;
    state: string;
    version: number;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
  };
  eventId: string;
};

type TaskBody = {
  task: {
    id: string;
    missionId: string;
    code: string;
    title: string;
    state: string;
    version: number;
  };
  eventId: string;
};

type ListBody<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

type EventBody = {
  event_id: string;
  event_type: string;
  actor_type: string;
  actor_id: string | null;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
};

let ctx: Fixture | undefined;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "agency-api-"));
  const dbPath = join(dir, "agency.db");
  const db = openDatabase(dbPath);
  const tenantA = createTenant(db, "Tenant A");
  const tenantB = createTenant(db, "Tenant B");
  const admin = issueToken(db, tenantA.id, {
    name: "admin-a",
    role: "ADMIN",
  });
  const viewer = issueToken(db, tenantA.id, {
    name: "viewer-a",
    role: "VIEWER",
  });
  const other = issueToken(db, tenantB.id, {
    name: "admin-b",
    role: "ADMIN",
  });
  const app = await buildServer({ db });
  await app.ready();
  ctx = { dir, dbPath, db, app, tenantA, tenantB, admin, viewer, other };
});

afterEach(async () => {
  if (ctx === undefined) return;
  const current = ctx;
  ctx = undefined;
  try {
    await current.app.close();
  } finally {
    if (current.db.isOpen) current.db.close();
    rmSync(current.dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

function fixture(): Fixture {
  if (ctx === undefined) throw new Error("Test fixture is not initialized");
  return ctx;
}

async function call(
  token: string | null,
  method: "GET" | "POST",
  url: string,
  payload?: object,
  extraHeaders?: Record<string, string>,
) {
  const headers: Record<string, string> = { ...extraHeaders };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return fixture().app.inject({
    method,
    url,
    headers,
    ...(payload === undefined ? {} : { payload }),
  });
}

async function createMission(
  token: string,
  title = "Mission",
): Promise<MissionBody> {
  const response = await call(token, "POST", "/v1/missions", { title });
  expect(response.statusCode).toBe(201);
  return response.json() as MissionBody;
}

function expectError(
  response: { statusCode: number; json: () => unknown },
  status: number,
  code: string,
): ErrorBody["error"] {
  expect(response.statusCode).toBe(status);
  const body = response.json() as ErrorBody;
  expect(body.error.code).toBe(code);
  expect(body.error.status).toBe(status);
  expect(body.error.requestId).toBeTruthy();
  return body.error;
}

describe("API health", () => {
  it("serves unauthenticated health and readiness responses", async () => {
    const health = await call(null, "GET", "/healthz");
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: "ok" });
    expect(health.headers["x-request-id"]).toBeTruthy();
    expect(health.headers["cache-control"]).toBe("no-store");

    const ready = await call(null, "GET", "/readyz");
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: "ready" });

    const spoofed = await fixture().app.inject({
      method: "GET",
      url: "/healthz",
      headers: { "x-request-id": "client-supplied-id" },
    });
    expect(spoofed.headers["x-request-id"]).toBeTruthy();
    expect(spoofed.headers["x-request-id"]).not.toBe("client-supplied-id");
  });
});

describe("API authentication", () => {
  it("rejects missing, malformed, unknown, and revoked tokens", async () => {
    const missing = await call(null, "GET", "/v1/whoami");
    expectError(missing, 401, "UNAUTHENTICATED");
    expect(missing.headers["www-authenticate"]).toContain("Bearer");

    const malformed = await fixture().app.inject({
      method: "GET",
      url: "/v1/whoami",
      headers: { authorization: "Basic abc" },
    });
    expectError(malformed, 401, "UNAUTHENTICATED");

    const unknown = await call("eaa_unknown", "GET", "/v1/whoami");
    expectError(unknown, 401, "UNAUTHENTICATED");

    const revokedToken = issueToken(fixture().db, fixture().tenantA.id, {
      name: "revoked",
      role: "ADMIN",
    });
    expect(
      revokeToken(fixture().db, fixture().tenantA.id, revokedToken.tokenId),
    ).toBe(true);
    const revoked = await call(revokedToken.token, "GET", "/v1/whoami");
    expectError(revoked, 401, "UNAUTHENTICATED");
  });

  it("returns the authenticated tenant and scopes", async () => {
    const response = await call(fixture().admin.token, "GET", "/v1/whoami");
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      tenantId: string;
      tenantName: string;
      role: string;
      scopes: string[];
    };
    expect(body.tenantId).toBe(fixture().tenantA.id);
    expect(body.tenantName).toBe("Tenant A");
    expect(body.role).toBe("ADMIN");
    expect(body.scopes).toContain("missions:write");
    expect(JSON.stringify(body)).not.toContain(fixture().admin.token);
  });

  it("stores only a hash of the token", () => {
    const row = fixture()
      .db.prepare("SELECT token_hash FROM api_tokens WHERE id = ?")
      .get(fixture().admin.tokenId) as { token_hash: string };
    expect(row.token_hash).toBe(hashToken(fixture().admin.token));
    expect(row.token_hash).not.toContain(fixture().admin.token);
    expect(row.token_hash).toHaveLength(64);
  });
});

describe("API mission lifecycle", () => {
  it("creates a mission in the initial state and allocates a code", async () => {
    const response = await call(fixture().admin.token, "POST", "/v1/missions", {
      title: "  Build a control plane  ",
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as MissionBody;
    expect(body.mission.code).toBe("MSN-0001");
    expect(body.mission.title).toBe("Build a control plane");
    expect(body.mission.description).toBe("");
    expect(body.mission.state).toBe("DRAFT");
    expect(body.mission.version).toBe(0);
    expect(body.mission.createdBy).toBe(fixture().admin.tokenId);
    expect(body.eventId).toMatch(/^[0-9a-f-]{36}$/);

    const second = await createMission(fixture().admin.token, "Second");
    expect(second.mission.code).toBe("MSN-0002");
  });

  it("paginates missions and exposes totals", async () => {
    await createMission(fixture().admin.token, "One");
    await createMission(fixture().admin.token, "Two");
    await createMission(fixture().admin.token, "Three");

    const first = await call(
      fixture().viewer.token,
      "GET",
      "/v1/missions?limit=2&offset=0",
    );
    expect(first.statusCode).toBe(200);
    const firstPage = first.json() as ListBody<MissionBody["mission"]>;
    expect(firstPage.total).toBe(3);
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.limit).toBe(2);

    const second = await call(
      fixture().viewer.token,
      "GET",
      "/v1/missions?limit=2&offset=2",
    );
    const secondPage = second.json() as ListBody<MissionBody["mission"]>;
    expect(secondPage.total).toBe(3);
    expect(secondPage.items).toHaveLength(1);
  });

  it("enforces scopes with default deny", async () => {
    const created = await createMission(fixture().admin.token);

    const deniedCreate = await call(fixture().viewer.token, "POST", "/v1/missions", {
      title: "Viewer mission",
    });
    expectError(deniedCreate, 403, "FORBIDDEN");

    const deniedTransition = await call(
      fixture().viewer.token,
      "POST",
      `/v1/missions/${created.mission.id}/transitions`,
      { to: "DISCOVERY", expectedVersion: 0 },
    );
    expectError(deniedTransition, 403, "FORBIDDEN");

    const allowedRead = await call(
      fixture().viewer.token,
      "GET",
      `/v1/missions/${created.mission.id}`,
    );
    expect(allowedRead.statusCode).toBe(200);
  });

  it("applies allowed transitions and rejects stale or invalid ones", async () => {
    const created = await createMission(fixture().admin.token);

    const moved = await call(
      fixture().admin.token,
      "POST",
      `/v1/missions/${created.mission.id}/transitions`,
      { to: "DISCOVERY", expectedVersion: 0, reason: "start discovery" },
    );
    expect(moved.statusCode).toBe(200);
    const movedBody = moved.json() as MissionBody;
    expect(movedBody.mission.state).toBe("DISCOVERY");
    expect(movedBody.mission.version).toBe(1);

    const stale = await call(
      fixture().admin.token,
      "POST",
      `/v1/missions/${created.mission.id}/transitions`,
      { to: "REQUIREMENTS", expectedVersion: 0 },
    );
    expectError(stale, 409, "CONFLICT");

    const invalid = await call(
      fixture().admin.token,
      "POST",
      `/v1/missions/${created.mission.id}/transitions`,
      { to: "COMPLETED", expectedVersion: 1 },
    );
    expectError(invalid, 409, "INVALID_TRANSITION");

    const unknown = await call(
      fixture().admin.token,
      "POST",
      `/v1/missions/${created.mission.id}/transitions`,
      { to: "BOGUS", expectedVersion: 1 },
    );
    expectError(unknown, 400, "VALIDATION_ERROR");

    const current = await call(
      fixture().admin.token,
      "GET",
      `/v1/missions/${created.mission.id}`,
    );
    expect((current.json() as MissionBody).mission.state).toBe("DISCOVERY");
  });

  it("returns durable events for an aggregate", async () => {
    const created = await createMission(fixture().admin.token);
    await call(
      fixture().admin.token,
      "POST",
      `/v1/missions/${created.mission.id}/transitions`,
      { to: "DISCOVERY", expectedVersion: 0 },
    );

    const events = await call(
      fixture().admin.token,
      "GET",
      `/v1/events?aggregateType=MISSION&aggregateId=${created.mission.id}`,
    );
    expect(events.statusCode).toBe(200);
    const body = events.json() as ListBody<EventBody>;
    expect(body.total).toBe(2);
    expect(body.items.map((event) => event.event_type)).toEqual([
      "MissionCreated",
      "MissionStateChanged",
    ]);
    expect(body.items[1]?.payload).toMatchObject({
      mission_id: created.mission.id,
      from: "DRAFT",
      to: "DISCOVERY",
    });
    expect(body.items[0]).toMatchObject({
      actor_type: "SERVICE",
      actor_id: fixture().admin.tokenId,
    });
    expect(body.items[1]).toMatchObject({
      actor_type: "SERVICE",
      actor_id: fixture().admin.tokenId,
    });
    expect(JSON.stringify(body)).not.toContain(fixture().admin.token);
  });
});

describe("API tenant isolation", () => {
  it("does not expose missions, tasks, or events across tenants", async () => {
    const created = await createMission(fixture().admin.token);

    const read = await call(
      fixture().other.token,
      "GET",
      `/v1/missions/${created.mission.id}`,
    );
    expectError(read, 404, "NOT_FOUND");

    const list = await call(fixture().other.token, "GET", "/v1/missions");
    expect((list.json() as ListBody<MissionBody["mission"]>).total).toBe(0);

    const transition = await call(
      fixture().other.token,
      "POST",
      `/v1/missions/${created.mission.id}/transitions`,
      { to: "DISCOVERY", expectedVersion: 0 },
    );
    expectError(transition, 404, "NOT_FOUND");

    const task = await call(
      fixture().other.token,
      "POST",
      `/v1/missions/${created.mission.id}/tasks`,
      { title: "Cross-tenant task" },
    );
    expectError(task, 404, "NOT_FOUND");

    const events = await call(
      fixture().other.token,
      "GET",
      `/v1/events?aggregateType=MISSION&aggregateId=${created.mission.id}`,
    );
    expect((events.json() as ListBody<EventBody>).total).toBe(0);
  });
});

describe("API task lifecycle", () => {
  it("creates and transitions tasks within a mission", async () => {
    const mission = await createMission(fixture().admin.token);

    const created = await call(
      fixture().admin.token,
      "POST",
      `/v1/missions/${mission.mission.id}/tasks`,
      { title: "Implement API" },
    );
    expect(created.statusCode).toBe(201);
    const taskBody = created.json() as TaskBody;
    expect(taskBody.task.code).toBe("TSK-0001");
    expect(taskBody.task.missionId).toBe(mission.mission.id);
    expect(taskBody.task.state).toBe("DRAFT");

    const moved = await call(
      fixture().admin.token,
      "POST",
      `/v1/tasks/${taskBody.task.id}/transitions`,
      { to: "READY", expectedVersion: 0 },
    );
    expect(moved.statusCode).toBe(200);
    expect((moved.json() as TaskBody).task.state).toBe("READY");

    const stale = await call(
      fixture().admin.token,
      "POST",
      `/v1/tasks/${taskBody.task.id}/transitions`,
      { to: "PLANNED", expectedVersion: 0 },
    );
    expectError(stale, 409, "CONFLICT");

    const list = await call(
      fixture().viewer.token,
      "GET",
      `/v1/missions/${mission.mission.id}/tasks`,
    );
    expect((list.json() as ListBody<TaskBody["task"]>).total).toBe(1);

    const crossTenant = await call(
      fixture().other.token,
      "GET",
      `/v1/tasks/${taskBody.task.id}`,
    );
    expectError(crossTenant, 404, "NOT_FOUND");
  });

  it("rejects task creation for a terminal mission", async () => {
    const mission = await createMission(fixture().admin.token);
    const cancelled = await call(
      fixture().admin.token,
      "POST",
      `/v1/missions/${mission.mission.id}/transitions`,
      { to: "CANCELLED", expectedVersion: 0 },
    );
    expect(cancelled.statusCode).toBe(200);

    const task = await call(
      fixture().admin.token,
      "POST",
      `/v1/missions/${mission.mission.id}/tasks`,
      { title: "Too late" },
    );
    expectError(task, 409, "CONFLICT");
  });
});

describe("API validation", () => {
  it("rejects malformed bodies, unknown fields, and invalid identifiers", async () => {
    const missingTitle = await call(
      fixture().admin.token,
      "POST",
      "/v1/missions",
      {},
    );
    expectError(missingTitle, 400, "VALIDATION_ERROR");

    const unknownField = await call(
      fixture().admin.token,
      "POST",
      "/v1/missions",
      { title: "Valid", tenantId: fixture().tenantB.id },
    );
    expectError(unknownField, 400, "VALIDATION_ERROR");

    const invalidId = await call(
      fixture().admin.token,
      "GET",
      `/v1/missions/${encodeURIComponent("' OR 1=1 --")}`,
    );
    expectError(invalidId, 400, "VALIDATION_ERROR");

    const missingId = await call(
      fixture().admin.token,
      "GET",
      "/v1/missions/00000000-0000-4000-8000-000000000000",
    );
    expectError(missingId, 404, "NOT_FOUND");

    const invalidLimit = await call(
      fixture().admin.token,
      "GET",
      "/v1/missions?limit=0",
    );
    expectError(invalidLimit, 400, "VALIDATION_ERROR");
  });

  it("returns a generic 500 without internal details", async () => {
    fixture().db.close();
    const response = await call(
      fixture().admin.token,
      "GET",
      "/v1/missions",
    );
    expect(response.statusCode).toBe(500);
    const body = response.json() as ErrorBody;
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).toBe("Internal server error");
    expect(body.error.details).toBeUndefined();
  });

  it("returns the JSON error envelope for unknown routes", async () => {
    const response = await call(fixture().admin.token, "GET", "/v1/unknown");
    expectError(response, 404, "NOT_FOUND");
  });
});

describe("API token expiry", () => {
  it("rejects expired tokens and reports expiry for active tokens", async () => {
    const expired = issueToken(fixture().db, fixture().tenantA.id, {
      name: "expired",
      role: "ADMIN",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const denied = await call(expired.token, "GET", "/v1/whoami");
    expectError(denied, 401, "UNAUTHENTICATED");

    const future = new Date(Date.now() + 86_400_000).toISOString();
    const active = issueToken(fixture().db, fixture().tenantA.id, {
      name: "active",
      role: "VIEWER",
      expiresAt: future,
    });
    const allowed = await call(active.token, "GET", "/v1/whoami");
    expect(allowed.statusCode).toBe(200);
    expect((allowed.json() as { expiresAt: string }).expiresAt).toBe(future);

    const noExpiry = issueToken(fixture().db, fixture().tenantA.id, {
      name: "no-expiry",
      role: "VIEWER",
      expiresAt: null,
    });
    const permanent = await call(noExpiry.token, "GET", "/v1/whoami");
    expect(permanent.statusCode).toBe(200);
    expect((permanent.json() as { expiresAt: string | null }).expiresAt).toBeNull();

    expect(fixture().admin.expiresAt).toBeTruthy();
    const ttlMs =
      Date.parse(fixture().admin.expiresAt as string) - Date.now();
    expect(ttlMs).toBeGreaterThan(29 * 86_400_000);
    expect(ttlMs).toBeLessThanOrEqual(30 * 86_400_000);
  });
});

describe("API rate limiting", () => {
  it("limits each token, returns Retry-After, and isolates other tokens", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agency-rate-"));
    const db = openDatabase(join(dir, "rate.db"));
    const tenant = createTenant(db, "Rate Tenant");
    const limited = issueToken(db, tenant.id, { name: "limited", role: "VIEWER" });
    const other = issueToken(db, tenant.id, { name: "other", role: "VIEWER" });
    const app = await buildServer({
      db,
      rateLimit: { max: 2, windowMs: 60_000 },
    });
    await app.ready();
    try {
      const request = (token: string) =>
        app.inject({
          method: "GET",
          url: "/v1/whoami",
          headers: { authorization: `Bearer ${token}` },
        });

      const first = await request(limited.token);
      expect(first.statusCode).toBe(200);
      expect(first.headers["x-ratelimit-limit"]).toBe("2");
      expect(first.headers["x-ratelimit-remaining"]).toBe("1");

      const second = await request(limited.token);
      expect(second.statusCode).toBe(200);
      expect(second.headers["x-ratelimit-remaining"]).toBe("0");

      const third = await request(limited.token);
      expectError(third, 429, "RATE_LIMITED");
      expect(third.headers["retry-after"]).toBe("60");
      expect(third.headers["x-ratelimit-remaining"]).toBe("0");

      const unaffected = await request(other.token);
      expect(unaffected.statusCode).toBe(200);
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    }
  });
});

describe("API idempotency", () => {
  it("replays a mission create and records one event", async () => {
    const key = "mission-create-1";
    const first = await call(
      fixture().admin.token,
      "POST",
      "/v1/missions",
      { title: "Once" },
      { "idempotency-key": key },
    );
    expect(first.statusCode).toBe(201);
    expect(first.headers["idempotency-replayed"]).toBeUndefined();
    const firstBody = first.json() as MissionBody;

    const replay = await call(
      fixture().admin.token,
      "POST",
      "/v1/missions",
      { title: "Once" },
      { "idempotency-key": key },
    );
    expect(replay.statusCode).toBe(201);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect((replay.json() as MissionBody).mission.id).toBe(firstBody.mission.id);

    const events = await call(
      fixture().admin.token,
      "GET",
      "/v1/events?aggregateType=MISSION",
    );
    expect((events.json() as ListBody<EventBody>).total).toBe(1);
  });

  it("rejects key reuse with a different body or tenant", async () => {
    const key = "mission-create-conflict";
    const created = await call(
      fixture().admin.token,
      "POST",
      "/v1/missions",
      { title: "Original" },
      { "idempotency-key": key },
    );
    expect(created.statusCode).toBe(201);

    const conflict = await call(
      fixture().admin.token,
      "POST",
      "/v1/missions",
      { title: "Changed" },
      { "idempotency-key": key },
    );
    expectError(conflict, 409, "CONFLICT");

    const otherTenant = await call(
      fixture().other.token,
      "POST",
      "/v1/missions",
      { title: "Original" },
      { "idempotency-key": key },
    );
    expect(otherTenant.statusCode).toBe(201);

    const invalid = await call(
      fixture().admin.token,
      "POST",
      "/v1/missions",
      { title: "Invalid key" },
      { "idempotency-key": "not a valid key!" },
    );
    expectError(invalid, 400, "VALIDATION_ERROR");
  });

  it("replays mission and task transitions without duplicating events", async () => {
    const mission = await createMission(fixture().admin.token);
    const missionKey = "mission-transition-1";
    const transitionBody = { to: "DISCOVERY", expectedVersion: 0 };

    const moved = await call(
      fixture().admin.token,
      "POST",
      `/v1/missions/${mission.mission.id}/transitions`,
      transitionBody,
      { "idempotency-key": missionKey },
    );
    expect(moved.statusCode).toBe(200);
    expect((moved.json() as MissionBody).mission.version).toBe(1);

    const movedReplay = await call(
      fixture().admin.token,
      "POST",
      `/v1/missions/${mission.mission.id}/transitions`,
      transitionBody,
      { "idempotency-key": missionKey },
    );
    expect(movedReplay.statusCode).toBe(200);
    expect(movedReplay.headers["idempotency-replayed"]).toBe("true");
    expect((movedReplay.json() as MissionBody).mission.version).toBe(1);

    const missionEvents = await call(
      fixture().admin.token,
      "GET",
      `/v1/events?aggregateType=MISSION&aggregateId=${mission.mission.id}`,
    );
    expect((missionEvents.json() as ListBody<EventBody>).total).toBe(2);

    const task = await call(
      fixture().admin.token,
      "POST",
      `/v1/missions/${mission.mission.id}/tasks`,
      { title: "Idempotent task" },
      { "idempotency-key": "task-create-1" },
    );
    expect(task.statusCode).toBe(201);
    const taskBody = task.json() as TaskBody;

    const taskTransition = { to: "READY", expectedVersion: 0 };
    const taskMoved = await call(
      fixture().admin.token,
      "POST",
      `/v1/tasks/${taskBody.task.id}/transitions`,
      taskTransition,
      { "idempotency-key": "task-transition-1" },
    );
    expect(taskMoved.statusCode).toBe(200);
    expect((taskMoved.json() as TaskBody).task.version).toBe(1);

    const taskMovedReplay = await call(
      fixture().admin.token,
      "POST",
      `/v1/tasks/${taskBody.task.id}/transitions`,
      taskTransition,
      { "idempotency-key": "task-transition-1" },
    );
    expect(taskMovedReplay.statusCode).toBe(200);
    expect(taskMovedReplay.headers["idempotency-replayed"]).toBe("true");

    const taskEvents = await call(
      fixture().admin.token,
      "GET",
      `/v1/events?aggregateType=TASK&aggregateId=${taskBody.task.id}`,
    );
    expect((taskEvents.json() as ListBody<EventBody>).total).toBe(2);
  });
});

describe("API audit export", () => {
  it("exports tenant-scoped events as NDJSON and JSON", async () => {
    const mission = await createMission(fixture().admin.token);
    await call(
      fixture().admin.token,
      "POST",
      `/v1/missions/${mission.mission.id}/transitions`,
      { to: "DISCOVERY", expectedVersion: 0 },
    );
    await createMission(fixture().other.token, "Other tenant mission");

    const ndjson = await call(
      fixture().viewer.token,
      "GET",
      "/v1/audit/export?format=ndjson",
    );
    expect(ndjson.statusCode).toBe(200);
    expect(ndjson.headers["content-type"]).toContain("application/x-ndjson");
    expect(ndjson.headers["content-disposition"]).toContain("attachment");
    const lines = ndjson.body.trim().split("\n");
    expect(lines).toHaveLength(2);
    const exported = lines.map((line) => JSON.parse(line) as EventBody);
    expect(exported.map((event) => event.event_type)).toEqual([
      "MissionCreated",
      "MissionStateChanged",
    ]);
    expect(ndjson.body).not.toContain(fixture().admin.token);
    expect(ndjson.body).not.toContain("Other tenant mission");

    const json = await call(
      fixture().admin.token,
      "GET",
      "/v1/audit/export?format=json&limit=1",
    );
    expect(json.statusCode).toBe(200);
    const jsonBody = json.json() as {
      tenantId: string;
      count: number;
      events: EventBody[];
    };
    expect(jsonBody.tenantId).toBe(fixture().tenantA.id);
    expect(jsonBody.count).toBe(1);
    expect(jsonBody.events).toHaveLength(1);

    const future = new Date(Date.now() + 86_400_000).toISOString();
    const empty = await call(
      fixture().admin.token,
      "GET",
      `/v1/audit/export?format=json&from=${encodeURIComponent(future)}`,
    );
    expect((empty.json() as { count: number }).count).toBe(0);

    const inverted = await call(
      fixture().admin.token,
      "GET",
      `/v1/audit/export?from=${encodeURIComponent(future)}&to=${encodeURIComponent("2020-01-01T00:00:00.000Z")}`,
    );
    expectError(inverted, 400, "VALIDATION_ERROR");
  });
});

describe("API metrics and traces", () => {
  it("exposes Prometheus metrics to admins and propagates trace context", async () => {
    await call(fixture().admin.token, "GET", "/v1/missions");

    const metrics = await call(fixture().admin.token, "GET", "/v1/metrics");
    expect(metrics.statusCode).toBe(200);
    expect(metrics.headers["content-type"]).toContain("text/plain");
    expect(metrics.body).toContain("agency_api_http_requests_total");
    expect(metrics.body).toContain('route="/v1/missions"');
    expect(metrics.body).toContain("agency_api_http_request_duration_ms_count");
    expect(metrics.body).toContain("agency_api_http_requests_in_flight 1");

    const denied = await call(fixture().viewer.token, "GET", "/v1/metrics");
    expectError(denied, 403, "FORBIDDEN");

    const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const traced = await call(
      fixture().admin.token,
      "GET",
      "/v1/whoami",
      undefined,
      { traceparent: `00-${traceId}-00f067aa0ba902b7-01` },
    );
    expect(traced.statusCode).toBe(200);
    expect(traced.headers["x-trace-id"]).toBe(traceId);
    expect(traced.headers.traceparent).toMatch(
      new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`),
    );
    expect(traced.headers["x-request-id"]).toBeTruthy();

    const invalid = await call(
      fixture().admin.token,
      "GET",
      "/v1/whoami",
      undefined,
      { traceparent: "00-00000000000000000000000000000000-0000000000000000-01" },
    );
    expect(invalid.statusCode).toBe(200);
    expect(invalid.headers["x-trace-id"]).toMatch(/^[0-9a-f]{32}$/);
    expect(invalid.headers["x-trace-id"]).not.toBe("0".repeat(32));
  });
});

describe("API schema migration", () => {
  it("migrates a v1 database to v2 without losing existing data", async () => {
    const mission = await createMission(fixture().admin.token, "Persisted");
    const db = fixture().db;
    db.exec(`
      DROP TABLE idempotency_keys;
      DROP INDEX idx_api_tokens_expires;
      ALTER TABLE api_tokens DROP COLUMN expires_at;
      PRAGMA user_version = 1;
    `);
    db.close();

    const reopened = openDatabase(fixture().dbPath);
    ctx = { ...fixture(), db: reopened };

    const version = reopened.prepare("PRAGMA user_version;").get() as {
      user_version: number;
    };
    expect(version.user_version).toBe(2);

    const columns = reopened
      .prepare("PRAGMA table_info(api_tokens);")
      .all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain("expires_at");

    const tables = reopened
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table';")
      .all() as Array<{ name: string }>;
    expect(tables.map((table) => table.name)).toContain("idempotency_keys");

    const row = reopened
      .prepare("SELECT title, state FROM missions WHERE id = ?")
      .get(mission.mission.id) as { title: string; state: string };
    expect(row.title).toBe("Persisted");
    expect(row.state).toBe("DRAFT");

    const token = reopened
      .prepare("SELECT token_hash FROM api_tokens WHERE id = ?")
      .get(fixture().admin.tokenId) as { token_hash: string };
    expect(token.token_hash).toBe(hashToken(fixture().admin.token));
  });
});

describe("API persistence", () => {
  it("recovers missions, events, and tokens after a process restart", async () => {
    const mission = await createMission(fixture().admin.token);
    const moved = await call(
      fixture().admin.token,
      "POST",
      `/v1/missions/${mission.mission.id}/transitions`,
      { to: "DISCOVERY", expectedVersion: 0 },
    );
    expect(moved.statusCode).toBe(200);

    await fixture().app.close();
    expect(fixture().db.isOpen).toBe(false);

    const db = openDatabase(fixture().dbPath);
    const app = await buildServer({ db });
    await app.ready();
    ctx = { ...fixture(), db, app };

    const restored = await call(
      fixture().admin.token,
      "GET",
      `/v1/missions/${mission.mission.id}`,
    );
    expect(restored.statusCode).toBe(200);
    const restoredBody = restored.json() as MissionBody;
    expect(restoredBody.mission.state).toBe("DISCOVERY");
    expect(restoredBody.mission.version).toBe(1);

    const events = await call(
      fixture().admin.token,
      "GET",
      `/v1/events?aggregateType=MISSION&aggregateId=${mission.mission.id}`,
    );
    expect((events.json() as ListBody<EventBody>).total).toBe(2);

    const next = await call(
      fixture().admin.token,
      "POST",
      `/v1/missions/${mission.mission.id}/transitions`,
      { to: "REQUIREMENTS", expectedVersion: 1 },
    );
    expect(next.statusCode).toBe(200);
    expect((next.json() as MissionBody).mission.state).toBe("REQUIREMENTS");
  });

  it("replays idempotent writes after a process restart", async () => {
    const key = "persisted-idempotency";
    const first = await call(
      fixture().admin.token,
      "POST",
      "/v1/missions",
      { title: "Persist once" },
      { "idempotency-key": key },
    );
    expect(first.statusCode).toBe(201);
    const firstBody = first.json() as MissionBody;

    await fixture().app.close();
    const db = openDatabase(fixture().dbPath);
    const app = await buildServer({ db });
    await app.ready();
    ctx = { ...fixture(), db, app };

    const replay = await call(
      fixture().admin.token,
      "POST",
      "/v1/missions",
      { title: "Persist once" },
      { "idempotency-key": key },
    );
    expect(replay.statusCode).toBe(201);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect((replay.json() as MissionBody).mission.id).toBe(firstBody.mission.id);

    const events = await call(
      fixture().admin.token,
      "GET",
      `/v1/events?aggregateType=MISSION&aggregateId=${firstBody.mission.id}`,
    );
    expect((events.json() as ListBody<EventBody>).total).toBe(1);
  });
});
