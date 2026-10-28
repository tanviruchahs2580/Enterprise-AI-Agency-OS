import {
  AppError,
  EventTypes,
  assertDomainEvent,
  createEvent,
  missionMachine,
  newCode,
  newId,
  taskMachine,
  type DomainEvent,
  type EventType,
  type MissionState,
  type TaskState,
} from "@agency/core";

import { withTransaction, type Database } from "./db.js";

export type Actor = {
  tokenId: string;
  requestId: string;
};

export type Mission = {
  id: string;
  code: string;
  title: string;
  description: string;
  state: MissionState;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type Task = {
  id: string;
  missionId: string;
  code: string;
  title: string;
  description: string;
  state: TaskState;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type MissionList = {
  items: Mission[];
  total: number;
  limit: number;
  offset: number;
};

export type TaskList = {
  items: Task[];
  total: number;
  limit: number;
  offset: number;
};

export type EventList = {
  items: DomainEvent[];
  total: number;
  limit: number;
  offset: number;
};

export type CreateMissionInput = {
  title: string;
  description: string;
};

export type CreateTaskInput = {
  title: string;
  description: string;
};

export type TransitionInput = {
  to: MissionState | TaskState;
  expectedVersion: number;
  reason?: string;
};

type MissionRow = {
  id: string;
  code: string;
  title: string;
  description: string;
  state: string;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type TaskRow = {
  id: string;
  mission_id: string;
  code: string;
  title: string;
  description: string;
  state: string;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type EventRow = {
  event_id: string;
  event_type: string;
  occurred_at: string;
  actor_type: string;
  actor_id: string | null;
  aggregate_type: string | null;
  aggregate_id: string | null;
  correlation_id: string | null;
  causation_id: string | null;
  payload_json: string;
};

export function createMission(
  db: Database,
  tenantId: string,
  input: CreateMissionInput,
  actor: Actor,
): { mission: Mission; eventId: string } {
  return withTransaction(db, () => {
    const id = newId();
    const now = new Date().toISOString();
    const code = nextCode(db, tenantId, "MSN");
    const state = missionMachine.initial as MissionState;

    db.prepare(`
      INSERT INTO missions
        (id, tenant_id, code, title, description, state, version, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(
      id,
      tenantId,
      code,
      input.title,
      input.description,
      state,
      actor.tokenId,
      now,
      now,
    );

    const mission: Mission = {
      id,
      code,
      title: input.title,
      description: input.description,
      state,
      version: 0,
      createdBy: actor.tokenId,
      createdAt: now,
      updatedAt: now,
    };
    const event = createEvent({
      type: EventTypes.MissionCreated,
      actorType: "SERVICE",
      actorId: actor.tokenId,
      aggregateType: "MISSION",
      aggregateId: id,
      correlationId: actor.requestId,
      payload: {
        mission_id: id,
        code,
        title: input.title,
        state,
      },
    });
    insertEvent(db, tenantId, event);
    return { mission, eventId: event.event_id };
  }, { reuseExisting: true });
}

export function getMission(
  db: Database,
  tenantId: string,
  missionId: string,
): Mission | undefined {
  const row = db
    .prepare(`
      SELECT id, code, title, description, state, version, created_by, created_at, updated_at
      FROM missions
      WHERE tenant_id = ? AND id = ?
    `)
    .get(tenantId, missionId) as MissionRow | undefined;
  return row === undefined ? undefined : toMission(row);
}

export function listMissions(
  db: Database,
  tenantId: string,
  limit: number,
  offset: number,
): MissionList {
  const rows = db
    .prepare(`
      SELECT id, code, title, description, state, version, created_by, created_at, updated_at
      FROM missions
      WHERE tenant_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `)
    .all(tenantId, limit, offset) as unknown as MissionRow[];
  const total = count(db, "missions", tenantId);
  return { items: rows.map(toMission), total, limit, offset };
}

export function transitionMission(
  db: Database,
  tenantId: string,
  missionId: string,
  input: TransitionInput,
  actor: Actor,
): { mission: Mission; eventId: string } {
  return withTransaction(db, () => {
    const row = db
      .prepare(`
        SELECT id, code, title, description, state, version, created_by, created_at, updated_at
        FROM missions
        WHERE tenant_id = ? AND id = ?
      `)
      .get(tenantId, missionId) as MissionRow | undefined;
    if (row === undefined) {
      throw AppError.notFound("Mission");
    }

    const current = toMission(row);
    if (current.version !== input.expectedVersion) {
      throw AppError.conflict("Mission version conflict", {
        expectedVersion: input.expectedVersion,
        actualVersion: current.version,
      });
    }

    const to = input.to as MissionState;
    missionMachine.assert(current.state, to);
    const now = new Date().toISOString();
    const result = db
      .prepare(`
        UPDATE missions
        SET state = ?, version = version + 1, updated_at = ?
        WHERE tenant_id = ? AND id = ? AND version = ?
      `)
      .run(to, now, tenantId, missionId, input.expectedVersion);
    if (Number(result.changes) !== 1) {
      throw AppError.conflict("Mission version conflict");
    }

    const mission: Mission = {
      ...current,
      state: to,
      version: current.version + 1,
      updatedAt: now,
    };
    const payload: Record<string, unknown> = {
      mission_id: missionId,
      from: current.state,
      to,
    };
    if (input.reason !== undefined) payload.reason = input.reason;
    const event = createEvent({
      type: EventTypes.MissionStateChanged,
      actorType: "SERVICE",
      actorId: actor.tokenId,
      aggregateType: "MISSION",
      aggregateId: missionId,
      correlationId: actor.requestId,
      payload,
    });
    insertEvent(db, tenantId, event);
    return { mission, eventId: event.event_id };
  }, { reuseExisting: true });
}

export function createTask(
  db: Database,
  tenantId: string,
  missionId: string,
  input: CreateTaskInput,
  actor: Actor,
): { task: Task; eventId: string } {
  return withTransaction(db, () => {
    const mission = db
      .prepare("SELECT state FROM missions WHERE tenant_id = ? AND id = ?")
      .get(tenantId, missionId) as { state: string } | undefined;
    if (mission === undefined) {
      throw AppError.notFound("Mission");
    }
    if (!missionMachine.hasState(mission.state)) {
      throw AppError.internal("Stored mission state is invalid");
    }
    if (missionMachine.isTerminal(mission.state)) {
      throw AppError.conflict("Cannot create a task for a terminal mission", {
        missionState: mission.state,
      });
    }

    const id = newId();
    const now = new Date().toISOString();
    const code = nextCode(db, tenantId, "TSK");
    const state = taskMachine.initial as TaskState;

    db.prepare(`
      INSERT INTO tasks
        (id, tenant_id, mission_id, code, title, description, state, version, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(
      id,
      tenantId,
      missionId,
      code,
      input.title,
      input.description,
      state,
      actor.tokenId,
      now,
      now,
    );

    const task: Task = {
      id,
      missionId,
      code,
      title: input.title,
      description: input.description,
      state,
      version: 0,
      createdBy: actor.tokenId,
      createdAt: now,
      updatedAt: now,
    };
    const event = createEvent({
      type: EventTypes.TaskCreated,
      actorType: "SERVICE",
      actorId: actor.tokenId,
      aggregateType: "TASK",
      aggregateId: id,
      correlationId: actor.requestId,
      payload: {
        task_id: id,
        mission_id: missionId,
        code,
        title: input.title,
        state,
      },
    });
    insertEvent(db, tenantId, event);
    return { task, eventId: event.event_id };
  }, { reuseExisting: true });
}

export function getTask(
  db: Database,
  tenantId: string,
  taskId: string,
): Task | undefined {
  const row = db
    .prepare(`
      SELECT id, mission_id, code, title, description, state, version, created_by, created_at, updated_at
      FROM tasks
      WHERE tenant_id = ? AND id = ?
    `)
    .get(tenantId, taskId) as TaskRow | undefined;
  return row === undefined ? undefined : toTask(row);
}

export function listTasks(
  db: Database,
  tenantId: string,
  missionId: string,
  limit: number,
  offset: number,
): TaskList {
  const mission = db
    .prepare("SELECT id FROM missions WHERE tenant_id = ? AND id = ?")
    .get(tenantId, missionId);
  if (mission === undefined) {
    throw AppError.notFound("Mission");
  }
  const rows = db
    .prepare(`
      SELECT id, mission_id, code, title, description, state, version, created_by, created_at, updated_at
      FROM tasks
      WHERE tenant_id = ? AND mission_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `)
    .all(tenantId, missionId, limit, offset) as unknown as TaskRow[];
  const total = db
    .prepare("SELECT COUNT(*) AS count FROM tasks WHERE tenant_id = ? AND mission_id = ?")
    .get(tenantId, missionId) as { count: number };
  return { items: rows.map(toTask), total: Number(total.count), limit, offset };
}

export function transitionTask(
  db: Database,
  tenantId: string,
  taskId: string,
  input: TransitionInput,
  actor: Actor,
): { task: Task; eventId: string } {
  return withTransaction(db, () => {
    const row = db
      .prepare(`
        SELECT id, mission_id, code, title, description, state, version, created_by, created_at, updated_at
        FROM tasks
        WHERE tenant_id = ? AND id = ?
      `)
      .get(tenantId, taskId) as TaskRow | undefined;
    if (row === undefined) {
      throw AppError.notFound("Task");
    }

    const current = toTask(row);
    if (current.version !== input.expectedVersion) {
      throw AppError.conflict("Task version conflict", {
        expectedVersion: input.expectedVersion,
        actualVersion: current.version,
      });
    }

    const to = input.to as TaskState;
    taskMachine.assert(current.state, to);
    const now = new Date().toISOString();
    const result = db
      .prepare(`
        UPDATE tasks
        SET state = ?, version = version + 1, updated_at = ?
        WHERE tenant_id = ? AND id = ? AND version = ?
      `)
      .run(to, now, tenantId, taskId, input.expectedVersion);
    if (Number(result.changes) !== 1) {
      throw AppError.conflict("Task version conflict");
    }

    const task: Task = {
      ...current,
      state: to,
      version: current.version + 1,
      updatedAt: now,
    };
    const payload: Record<string, unknown> = {
      task_id: taskId,
      mission_id: task.missionId,
      from: current.state,
      to,
    };
    if (input.reason !== undefined) payload.reason = input.reason;
    const event = createEvent({
      type: EventTypes.TaskStateChanged,
      actorType: "SERVICE",
      actorId: actor.tokenId,
      aggregateType: "TASK",
      aggregateId: taskId,
      correlationId: actor.requestId,
      payload,
    });
    insertEvent(db, tenantId, event);
    return { task, eventId: event.event_id };
  }, { reuseExisting: true });
}

export function exportEvents(
  db: Database,
  tenantId: string,
  filter: { from?: string; to?: string; limit: number },
): DomainEvent[] {
  const conditions = ["tenant_id = ?"];
  const params: (string | number)[] = [tenantId];
  if (filter.from !== undefined) {
    conditions.push("occurred_at >= ?");
    params.push(filter.from);
  }
  if (filter.to !== undefined) {
    conditions.push("occurred_at <= ?");
    params.push(filter.to);
  }
  const rows = db
    .prepare(`
      SELECT
        event_id, event_type, occurred_at, actor_type, actor_id,
        aggregate_type, aggregate_id, correlation_id, causation_id, payload_json
      FROM domain_events
      WHERE ${conditions.join(" AND ")}
      ORDER BY occurred_at ASC, event_id ASC
      LIMIT ?
    `)
    .all(...params, filter.limit) as unknown as EventRow[];
  return rows.map(toEvent);
}

export function listEvents(
  db: Database,
  tenantId: string,
  filter: {
    aggregateType?: string;
    aggregateId?: string;
    limit: number;
    offset: number;
  },
): EventList {
  const conditions = ["tenant_id = ?"];
  const params: (string | number)[] = [tenantId];
  if (filter.aggregateType !== undefined) {
    conditions.push("aggregate_type = ?");
    params.push(filter.aggregateType);
  }
  if (filter.aggregateId !== undefined) {
    conditions.push("aggregate_id = ?");
    params.push(filter.aggregateId);
  }
  const where = conditions.join(" AND ");

  const countRow = db
    .prepare(`SELECT COUNT(*) AS count FROM domain_events WHERE ${where}`)
    .get(...params) as { count: number };
  const rows = db
    .prepare(`
      SELECT
        event_id, event_type, occurred_at, actor_type, actor_id,
        aggregate_type, aggregate_id, correlation_id, causation_id, payload_json
      FROM domain_events
      WHERE ${where}
      ORDER BY occurred_at ASC, event_id ASC
      LIMIT ? OFFSET ?
    `)
    .all(...params, filter.limit, filter.offset) as unknown as EventRow[];

  return {
    items: rows.map(toEvent),
    total: Number(countRow.count),
    limit: filter.limit,
    offset: filter.offset,
  };
}

function nextCode(db: Database, tenantId: string, name: string): string {
  const row = db
    .prepare(`
      INSERT INTO counters (tenant_id, name, value)
      VALUES (?, ?, 1)
      ON CONFLICT (tenant_id, name) DO UPDATE SET value = value + 1
      RETURNING value
    `)
    .get(tenantId, name) as { value: number } | undefined;
  if (row === undefined) {
    throw new Error("Failed to allocate a sequence number");
  }
  return newCode(name, Number(row.value));
}

function insertEvent(db: Database, tenantId: string, event: DomainEvent): void {
  if (event.aggregate_type === null || event.aggregate_id === null) {
    throw new Error("Persisted events require aggregate type and id");
  }
  db.prepare(`
    INSERT INTO domain_events
      (event_id, tenant_id, aggregate_type, aggregate_id, event_type, schema_version,
       occurred_at, actor_type, actor_id, correlation_id, causation_id, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.event_id,
    tenantId,
    event.aggregate_type,
    event.aggregate_id,
    event.event_type,
    event.schema_version,
    event.occurred_at,
    event.actor_type,
    event.actor_id,
    event.correlation_id,
    event.causation_id,
    JSON.stringify(event.payload),
  );
}

function count(db: Database, table: "missions" | "tasks", tenantId: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id = ?`)
    .get(tenantId) as { count: number };
  return Number(row.count);
}

function toMission(row: MissionRow): Mission {
  if (!missionMachine.hasState(row.state)) {
    throw AppError.internal("Stored mission state is invalid");
  }
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    description: row.description,
    state: row.state as MissionState,
    version: Number(row.version),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTask(row: TaskRow): Task {
  if (!taskMachine.hasState(row.state)) {
    throw AppError.internal("Stored task state is invalid");
  }
  return {
    id: row.id,
    missionId: row.mission_id,
    code: row.code,
    title: row.title,
    description: row.description,
    state: row.state as TaskState,
    version: Number(row.version),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toEvent(row: EventRow): DomainEvent {
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    throw AppError.internal("Stored event payload is invalid");
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw AppError.internal("Stored event payload is invalid");
  }
  const event: DomainEvent = {
    schema_version: 1,
    event_id: row.event_id,
    event_type: row.event_type as EventType,
    occurred_at: row.occurred_at,
    actor_type: row.actor_type,
    actor_id: row.actor_id,
    aggregate_type: row.aggregate_type,
    aggregate_id: row.aggregate_id,
    correlation_id: row.correlation_id,
    causation_id: row.causation_id,
    payload: payload as Record<string, unknown>,
  };
  try {
    assertDomainEvent(event);
  } catch {
    throw AppError.internal("Stored event envelope is invalid");
  }
  return event;
}
