import { AppError } from "./errors.js";
import { newId } from "./ids.js";
import { MISSION_STATES, TASK_STATES } from "./state-machine.js";

export const EventTypes = Object.freeze({
  ProjectCreated: "ProjectCreated",
  MissionCreated: "MissionCreated",
  MissionStateChanged: "MissionStateChanged",
  RequirementApproved: "RequirementApproved",
  ArchitectureRecorded: "ArchitectureRecorded",
  WorkflowStarted: "WorkflowStarted",
  WorkflowStageCompleted: "WorkflowStageCompleted",
  TaskCreated: "TaskCreated",
  TaskAssigned: "TaskAssigned",
  TaskStateChanged: "TaskStateChanged",
  AgentStarted: "AgentStarted",
  AgentFinished: "AgentFinished",
  AgentHeartbeat: "AgentHeartbeat",
  TestFailed: "TestFailed",
  ReviewRequested: "ReviewRequested",
  ReviewCompleted: "ReviewCompleted",
  SecurityFindingCreated: "SecurityFindingCreated",
  ApprovalRequested: "ApprovalRequested",
  ApprovalDecided: "ApprovalDecided",
  DeploymentStarted: "DeploymentStarted",
  DeploymentSucceeded: "DeploymentSucceeded",
  DeploymentFailed: "DeploymentFailed",
  RollbackStarted: "RollbackStarted",
  RollbackCompleted: "RollbackCompleted",
  BudgetExceeded: "BudgetExceeded",
  ModelFallback: "ModelFallback",
  KnowledgeCaptured: "KnowledgeCaptured",
} as const);

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];

const EVENT_TYPE_VALUES: ReadonlySet<string> = new Set(Object.values(EventTypes));
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MISSION_STATE_VALUES: ReadonlySet<string> = new Set(MISSION_STATES);
const TASK_STATE_VALUES: ReadonlySet<string> = new Set(TASK_STATES);

type PayloadValidator = (payload: Record<string, unknown>) => string | null;

function hasOnlyKeys(
  payload: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(payload).every((key) => allowed.includes(key));
}

function validateMissionCreated(payload: Record<string, unknown>): string | null {
  if (!isNonBlankString(payload.mission_id)) {
    return "mission_id must be a non-empty string";
  }
  if (!isNonBlankString(payload.code)) return "code must be a non-empty string";
  if (!isNonBlankString(payload.title)) return "title must be a non-empty string";
  if (
    typeof payload.state !== "string" ||
    !MISSION_STATE_VALUES.has(payload.state)
  ) {
    return "state must be a declared mission state";
  }
  if (!hasOnlyKeys(payload, ["mission_id", "code", "title", "state"])) {
    return "contains an undeclared field";
  }
  return null;
}

function validateMissionStateChanged(
  payload: Record<string, unknown>,
): string | null {
  if (!isNonBlankString(payload.mission_id)) {
    return "mission_id must be a non-empty string";
  }
  if (typeof payload.from !== "string" || !MISSION_STATE_VALUES.has(payload.from)) {
    return "from must be a declared mission state";
  }
  if (typeof payload.to !== "string" || !MISSION_STATE_VALUES.has(payload.to)) {
    return "to must be a declared mission state";
  }
  if (
    payload.reason !== undefined &&
    !isNonBlankString(payload.reason)
  ) {
    return "reason must be a non-empty string when present";
  }
  if (
    !hasOnlyKeys(payload, ["mission_id", "from", "to", "reason"])
  ) {
    return "contains an undeclared field";
  }
  return null;
}

function validateTaskCreated(payload: Record<string, unknown>): string | null {
  if (!isNonBlankString(payload.task_id)) {
    return "task_id must be a non-empty string";
  }
  if (!isNonBlankString(payload.mission_id)) {
    return "mission_id must be a non-empty string";
  }
  if (!isNonBlankString(payload.code)) return "code must be a non-empty string";
  if (!isNonBlankString(payload.title)) return "title must be a non-empty string";
  if (typeof payload.state !== "string" || !TASK_STATE_VALUES.has(payload.state)) {
    return "state must be a declared task state";
  }
  if (
    !hasOnlyKeys(payload, ["task_id", "mission_id", "code", "title", "state"])
  ) {
    return "contains an undeclared field";
  }
  return null;
}

function validateTaskStateChanged(
  payload: Record<string, unknown>,
): string | null {
  if (!isNonBlankString(payload.task_id)) {
    return "task_id must be a non-empty string";
  }
  if (!isNonBlankString(payload.mission_id)) {
    return "mission_id must be a non-empty string";
  }
  if (typeof payload.from !== "string" || !TASK_STATE_VALUES.has(payload.from)) {
    return "from must be a declared task state";
  }
  if (typeof payload.to !== "string" || !TASK_STATE_VALUES.has(payload.to)) {
    return "to must be a declared task state";
  }
  if (payload.reason !== undefined && !isNonBlankString(payload.reason)) {
    return "reason must be a non-empty string when present";
  }
  if (
    !hasOnlyKeys(payload, ["task_id", "mission_id", "from", "to", "reason"])
  ) {
    return "contains an undeclared field";
  }
  return null;
}

const PAYLOAD_VALIDATORS: Partial<Record<EventType, PayloadValidator>> =
  Object.freeze({
    [EventTypes.MissionCreated]: validateMissionCreated,
    [EventTypes.MissionStateChanged]: validateMissionStateChanged,
    [EventTypes.TaskCreated]: validateTaskCreated,
    [EventTypes.TaskStateChanged]: validateTaskStateChanged,
  });

function payloadError(
  type: EventType,
  payload: Record<string, unknown>,
): string | null {
  const validator = PAYLOAD_VALIDATORS[type];
  return validator === undefined ? null : validator(payload);
}

export function isEventPayload(
  type: EventType,
  payload: Record<string, unknown>,
): boolean {
  return payloadError(type, payload) === null;
}

export function assertEventPayload(
  type: EventType,
  payload: Record<string, unknown>,
): void {
  let error: string | null;
  try {
    error = payloadError(type, payload);
  } catch {
    throw AppError.validation(
      `Invalid ${type} payload: payload could not be read`,
    );
  }
  if (error !== null) {
    throw AppError.validation(`Invalid ${type} payload: ${error}`);
  }
}

export function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && EVENT_TYPE_VALUES.has(value);
}

export interface DomainEvent<T extends Record<string, unknown> = Record<string, unknown>> {
  schema_version: 1;
  event_id: string;
  event_type: EventType;
  occurred_at: string;
  actor_type: string;
  actor_id: string | null;
  aggregate_type: string | null;
  aggregate_id: string | null;
  correlation_id: string | null;
  causation_id: string | null;
  payload: T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function ownData(
  value: object,
  key: string,
): { present: true; value: unknown } | { present: false } {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor)) {
    return { present: false };
  }
  return { present: true, value: descriptor.value };
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isNullableId(value: unknown): value is string | null {
  return value === null || isNonBlankString(value);
}

function isIsoUtcTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ISO_UTC.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function optionalId(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (!isNonBlankString(value)) {
    throw AppError.validation(`${field} must be a non-empty string or null`);
  }
  return value;
}

function optionalLabel(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (!isNonBlankString(value)) {
    throw AppError.validation(`${field} must be a non-empty string or null`);
  }
  return value;
}

export function createEvent<T extends Record<string, unknown>>(input: {
  type: EventType;
  payload: T;
  actorType?: string;
  actorId?: string | null;
  aggregateType?: string;
  aggregateId?: string;
  correlationId?: string;
  causationId?: string;
}): DomainEvent<T> {
  if (!isRecord(input)) {
    throw AppError.validation("Event input must be an object");
  }
  if (!isEventType(input.type)) {
    throw AppError.validation(`Unknown event type: ${String(input.type)}`);
  }
  if (!isRecord(input.payload)) {
    throw AppError.validation("Event payload must be a non-array object");
  }
  assertEventPayload(input.type, input.payload);

  const actorType =
    input.actorType === undefined
      ? "SYSTEM"
      : (() => {
          if (!isNonBlankString(input.actorType)) {
            throw AppError.validation("Event actor type must be a non-empty string");
          }
          return input.actorType.trim();
        })();

  const event: DomainEvent<T> = {
    schema_version: 1,
    event_id: newId(),
    event_type: input.type,
    occurred_at: new Date().toISOString(),
    actor_type: actorType,
    actor_id: optionalId(input.actorId, "actorId"),
    aggregate_type: optionalLabel(input.aggregateType, "aggregateType"),
    aggregate_id: optionalId(input.aggregateId, "aggregateId"),
    correlation_id: optionalId(input.correlationId, "correlationId"),
    causation_id: optionalId(input.causationId, "causationId"),
    payload: input.payload,
  };

  assertDomainEvent(event);
  return event;
}

export function isDomainEvent(value: unknown): value is DomainEvent {
  try {
    if (!isRecord(value)) return false;

    const schemaVersion = ownData(value, "schema_version");
    const eventId = ownData(value, "event_id");
    const eventType = ownData(value, "event_type");
    const occurredAt = ownData(value, "occurred_at");
    const actorType = ownData(value, "actor_type");
    const actorId = ownData(value, "actor_id");
    const aggregateType = ownData(value, "aggregate_type");
    const aggregateId = ownData(value, "aggregate_id");
    const correlationId = ownData(value, "correlation_id");
    const causationId = ownData(value, "causation_id");
    const payload = ownData(value, "payload");

    return (
      schemaVersion.present &&
      schemaVersion.value === 1 &&
      eventId.present &&
      isNonBlankString(eventId.value) &&
      eventType.present &&
      isEventType(eventType.value) &&
      occurredAt.present &&
      isIsoUtcTimestamp(occurredAt.value) &&
      actorType.present &&
      isNonBlankString(actorType.value) &&
      actorId.present &&
      isNullableId(actorId.value) &&
      aggregateType.present &&
      isNullableId(aggregateType.value) &&
      aggregateId.present &&
      isNullableId(aggregateId.value) &&
      correlationId.present &&
      isNullableId(correlationId.value) &&
      causationId.present &&
      isNullableId(causationId.value) &&
      payload.present &&
      isRecord(payload.value) &&
      isEventPayload(eventType.value, payload.value)
    );
  } catch {
    return false;
  }
}

export function assertDomainEvent(value: unknown): asserts value is DomainEvent {
  if (!isDomainEvent(value)) {
    throw AppError.validation("Invalid domain event envelope");
  }
}
