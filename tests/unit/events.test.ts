import { describe, expect, it } from "vitest";

import { AppError } from "../../packages/core/src/errors.js";
import {
  EventTypes,
  assertDomainEvent,
  createEvent,
  isDomainEvent,
  isEventType,
  type EventType,
} from "../../packages/core/src/events.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("EventTypes", () => {
  it("is frozen and recognizes only declared event types", () => {
    expect(Object.isFrozen(EventTypes)).toBe(true);
    expect(isEventType("MissionCreated")).toBe(true);
    expect(isEventType("UnknownEvent")).toBe(false);
    expect(isEventType(123)).toBe(false);
  });
});

describe("createEvent", () => {
  it("creates a versioned event envelope with generated identity and timestamp", () => {
    const payload = { mission_id: "mis_1", from: "DRAFT", to: "DISCOVERY" } as const;
    const event = createEvent({
      type: EventTypes.MissionStateChanged,
      payload,
      actorType: "USER",
      actorId: "usr_1",
      aggregateType: "mission",
      aggregateId: "mis_1",
      correlationId: "corr_1",
      causationId: "evt_0",
    });

    expect(event.schema_version).toBe(1);
    expect(event.event_id).toMatch(UUID_V4);
    expect(event.event_type).toBe("MissionStateChanged");
    expect(Number.isNaN(Date.parse(event.occurred_at))).toBe(false);
    expect(event.occurred_at).toBe(new Date(event.occurred_at).toISOString());
    expect(event.actor_type).toBe("USER");
    expect(event.actor_id).toBe("usr_1");
    expect(event.aggregate_type).toBe("mission");
    expect(event.aggregate_id).toBe("mis_1");
    expect(event.correlation_id).toBe("corr_1");
    expect(event.causation_id).toBe("evt_0");
    expect(event.payload).toBe(payload);
    expect(isDomainEvent(event)).toBe(true);
  });

  it("defaults actor to SYSTEM and optional references to null", () => {
    const event = createEvent({
      type: EventTypes.ProjectCreated,
      payload: { project_id: "prj_1" },
    });

    expect(event.actor_type).toBe("SYSTEM");
    expect(event.actor_id).toBeNull();
    expect(event.aggregate_type).toBeNull();
    expect(event.aggregate_id).toBeNull();
    expect(event.correlation_id).toBeNull();
    expect(event.causation_id).toBeNull();
  });

  it("rejects unknown event types at runtime", () => {
    expect(() =>
      createEvent({
        type: "UnknownEvent" as EventType,
        payload: {},
      }),
    ).toThrow(/Unknown event type/);
  });

  it("rejects non-object payloads at runtime", () => {
    expect(() =>
      createEvent({
        type: EventTypes.ProjectCreated,
        payload: null as unknown as Record<string, unknown>,
      }),
    ).toThrow(/payload must be a non-array object/);

    expect(() =>
      createEvent({
        type: EventTypes.ProjectCreated,
        payload: [] as unknown as Record<string, unknown>,
      }),
    ).toThrow(/payload must be a non-array object/);
  });

  it("trims a valid actor type", () => {
    const event = createEvent({
      type: EventTypes.ProjectCreated,
      payload: {},
      actorType: "  USER  ",
    });

    expect(event.actor_type).toBe("USER");
  });

  it("rejects empty actor types", () => {
    expect(() =>
      createEvent({
        type: EventTypes.ProjectCreated,
        payload: {},
        actorType: "   ",
      }),
    ).toThrow(/actor type must be a non-empty string/);

    expect(() =>
      createEvent({
        type: EventTypes.ProjectCreated,
        payload: {},
        actorType: null as unknown as string,
      }),
    ).toThrow(/actor type must be a non-empty string/);
  });

  it("rejects invalid optional identifiers and labels", () => {
    const cases: Array<Record<string, unknown>> = [
      { actorId: 7 },
      { actorId: "" },
      { actorId: "   " },
      { aggregateType: 7 },
      { aggregateType: "" },
      { aggregateId: 7 },
      { aggregateId: "\t" },
      { correlationId: {} },
      { causationId: [] },
    ];

    for (const overrides of cases) {
      expect(() =>
        createEvent({
          type: EventTypes.ProjectCreated,
          payload: {},
          ...overrides,
        } as Parameters<typeof createEvent>[0]),
      ).toThrow(AppError);
    }
  });

  it("rejects a non-object input at runtime", () => {
    expect(() => createEvent(null as unknown as Parameters<typeof createEvent>[0])).toThrow(
      /Event input must be an object/,
    );
    expect(() => createEvent([] as unknown as Parameters<typeof createEvent>[0])).toThrow(
      /Event input must be an object/,
    );
  });
});

describe("event payload schemas", () => {
  it("accepts complete mission and task payloads", () => {
    const missionCreated = createEvent({
      type: EventTypes.MissionCreated,
      payload: {
        mission_id: "mis_1",
        code: "MSN-0001",
        title: "Mission",
        state: "DRAFT",
      },
    });
    expect(isDomainEvent(missionCreated)).toBe(true);

    const missionChanged = createEvent({
      type: EventTypes.MissionStateChanged,
      payload: {
        mission_id: "mis_1",
        from: "DRAFT",
        to: "DISCOVERY",
        reason: "start",
      },
    });
    expect(isDomainEvent(missionChanged)).toBe(true);

    const taskCreated = createEvent({
      type: EventTypes.TaskCreated,
      payload: {
        task_id: "tsk_1",
        mission_id: "mis_1",
        code: "TSK-0001",
        title: "Task",
        state: "DRAFT",
      },
    });
    expect(isDomainEvent(taskCreated)).toBe(true);

    const taskChanged = createEvent({
      type: EventTypes.TaskStateChanged,
      payload: {
        task_id: "tsk_1",
        mission_id: "mis_1",
        from: "DRAFT",
        to: "READY",
      },
    });
    expect(isDomainEvent(taskChanged)).toBe(true);
  });

  it("rejects missing, malformed, and undeclared payload fields", () => {
    const cases: Array<Record<string, unknown>> = [
      { mission_id: "mis_1" },
      { mission_id: "mis_1", code: "MSN-1", title: "M", state: "BOGUS" },
      { mission_id: "mis_1", code: "", title: "M", state: "DRAFT" },
      {
        mission_id: "mis_1",
        code: "MSN-1",
        title: "M",
        state: "DRAFT",
        tenantId: "tenant-b",
      },
    ];
    for (const payload of cases) {
      expect(() =>
        createEvent({ type: EventTypes.MissionCreated, payload }),
      ).toThrow(/Invalid MissionCreated payload/);
    }

    expect(() =>
      createEvent({
        type: EventTypes.MissionStateChanged,
        payload: { mission_id: "mis_1", from: "DRAFT", to: "BOGUS" },
      }),
    ).toThrow(/declared mission state/);

    expect(() =>
      createEvent({
        type: EventTypes.TaskStateChanged,
        payload: {
          task_id: "tsk_1",
          mission_id: "mis_1",
          from: "DRAFT",
          to: "READY",
          reason: " ",
        },
      }),
    ).toThrow(/reason must be a non-empty string/);
  });

  it("keeps envelope-only validation for event types without a declared schema", () => {
    const event = createEvent({
      type: EventTypes.ProjectCreated,
      payload: { project_id: "prj_1", arbitrary: { nested: true } },
    });
    expect(isDomainEvent(event)).toBe(true);
  });

  it("converts hostile payload access into a validation error", () => {
    const hostile = {
      get mission_id(): string {
        throw new Error("hostile getter");
      },
      code: "MSN-1",
      title: "Mission",
      state: "DRAFT",
    };
    expect(() =>
      createEvent({ type: EventTypes.MissionCreated, payload: hostile }),
    ).toThrow(AppError);
  });

  it("rejects persisted events whose payload no longer matches its schema", () => {
    const valid = createEvent({
      type: EventTypes.TaskCreated,
      payload: {
        task_id: "tsk_1",
        mission_id: "mis_1",
        code: "TSK-0001",
        title: "Task",
        state: "DRAFT",
      },
    });
    expect(isDomainEvent({ ...valid, payload: { task_id: "tsk_1" } })).toBe(false);
  });
});

describe("domain event validation", () => {
  const valid = createEvent({
    type: EventTypes.TaskCreated,
    payload: {
      task_id: "tsk_1",
      mission_id: "mis_1",
      code: "TSK-0001",
      title: "Task",
      state: "DRAFT",
    },
  });

  it("accepts a valid envelope", () => {
    expect(isDomainEvent(valid)).toBe(true);
    expect(() => assertDomainEvent(valid)).not.toThrow();
  });

  it("rejects malformed envelopes", () => {
    expect(isDomainEvent(null)).toBe(false);
    expect(isDomainEvent([])).toBe(false);
    expect(isDomainEvent("event")).toBe(false);
    expect(isDomainEvent({ ...valid, schema_version: 2 })).toBe(false);
    expect(isDomainEvent({ ...valid, event_id: "" })).toBe(false);
    expect(isDomainEvent({ ...valid, event_id: "   " })).toBe(false);
    expect(isDomainEvent({ ...valid, event_type: "UnknownEvent" })).toBe(false);
    expect(isDomainEvent({ ...valid, occurred_at: "not-a-date" })).toBe(false);
    expect(isDomainEvent({ ...valid, occurred_at: "10/22/2026" })).toBe(false);
    expect(isDomainEvent({ ...valid, occurred_at: "2026-02-30T00:00:00.000Z" })).toBe(false);
    expect(isDomainEvent({ ...valid, actor_type: "" })).toBe(false);
    expect(isDomainEvent({ ...valid, actor_type: "   " })).toBe(false);
    expect(isDomainEvent({ ...valid, actor_id: 7 })).toBe(false);
    expect(isDomainEvent({ ...valid, aggregate_type: 7 })).toBe(false);
    expect(isDomainEvent({ ...valid, correlation_id: 7 })).toBe(false);
    expect(isDomainEvent({ ...valid, payload: null })).toBe(false);
    expect(isDomainEvent({ ...valid, payload: [] })).toBe(false);
  });

  it("requires own data properties and does not throw on hostile objects", () => {
    const inherited = Object.create(valid) as Record<string, unknown>;
    expect(isDomainEvent(inherited)).toBe(false);

    const accessor = {
      ...valid,
      get event_id() {
        return valid.event_id;
      },
    };
    expect(isDomainEvent(accessor)).toBe(false);

    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error("hostile descriptor");
        },
      },
    );
    expect(isDomainEvent(hostile)).toBe(false);
  });

  it("throws a validation AppError for a malformed envelope", () => {
    try {
      assertDomainEvent({ ...valid, payload: null });
      throw new Error("expected assertDomainEvent to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("VALIDATION_ERROR");
      expect((error as AppError).status).toBe(400);
    }
  });
});
