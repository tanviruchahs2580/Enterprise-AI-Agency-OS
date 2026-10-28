import assert from "node:assert/strict";

import {
  AppError,
  EventTypes,
  createEvent,
  deploymentMachine,
  isDomainEvent,
  missionMachine,
  shortHash,
  taskMachine,
} from "../packages/core/dist/index.js";

missionMachine.assert("DRAFT", "DISCOVERY");
taskMachine.assert("DRAFT", "READY");
deploymentMachine.assert("FAILED", "BUILDING");

const event = createEvent({
  type: EventTypes.MissionCreated,
  payload: {
    mission_id: "mis_smoke",
    code: "MSN-0001",
    title: "Smoke mission",
    state: "DRAFT",
  },
});
assert.equal(isDomainEvent(event), true);
assert.equal(event.schema_version, 1);
assert.equal(event.actor_type, "SYSTEM");

assert.equal(
  shortHash("abc", 64),
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
);
assert.equal(shortHash("abc").length, 16);

assert.throws(
  () => missionMachine.assert("DRAFT", "COMPLETED"),
  (error) => error instanceof AppError && error.code === "INVALID_TRANSITION",
);
assert.equal(isDomainEvent({ ...event, payload: null }), false);

console.log("core smoke passed");
