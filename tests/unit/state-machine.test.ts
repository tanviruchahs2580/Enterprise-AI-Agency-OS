import { describe, expect, it } from "vitest";

import { AppError } from "../../packages/core/src/errors.js";
import {
  DEPLOYMENT_STATES,
  MISSION_STATES,
  StateMachine,
  TASK_STATES,
  deploymentMachine,
  missionMachine,
  taskMachine,
  type Transition,
} from "../../packages/core/src/state-machine.js";

function createWorkMachine(): StateMachine {
  return new StateMachine(
    "work",
    [
      { from: "DRAFT", to: "ACTIVE" },
      { from: "ACTIVE", to: "DONE" },
    ],
    {
      states: ["DRAFT", "ACTIVE", "DONE"],
      initial: "DRAFT",
      terminal: ["DONE"],
    },
  );
}

describe("StateMachine", () => {
  it("exposes declared states and allows declared transitions", () => {
    const machine = createWorkMachine();

    expect(machine.entity).toBe("work");
    expect(machine.initial).toBe("DRAFT");
    expect([...machine.states]).toEqual(["DRAFT", "ACTIVE", "DONE"]);
    expect(machine.hasState("ACTIVE")).toBe(true);
    expect(machine.hasState("UNKNOWN")).toBe(false);
    expect(machine.can("DRAFT", "ACTIVE")).toBe(true);
    expect(machine.can("DRAFT", "DONE")).toBe(false);
    expect(machine.nextStates("DRAFT")).toEqual(["ACTIVE"]);
    expect(() => machine.assert("DRAFT", "ACTIVE")).not.toThrow();
  });

  it("throws a typed AppError for an invalid transition", () => {
    const machine = createWorkMachine();

    expect(() => machine.assert("DRAFT", "DONE")).toThrow(AppError);

    try {
      machine.assert("DRAFT", "DONE");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.code).toBe("INVALID_TRANSITION");
      expect(appError.status).toBe(409);
      expect(appError.details).toEqual({ from: "DRAFT", to: "DONE", entity: "work" });
    }
  });

  it("rejects undeclared self transitions but permits explicit ones", () => {
    const strict = createWorkMachine();
    expect(strict.can("ACTIVE", "ACTIVE")).toBe(false);
    expect(() => strict.assert("ACTIVE", "ACTIVE")).toThrow(AppError);

    const loop = new StateMachine(
      "loop",
      [
        { from: "A", to: "A" },
        { from: "A", to: "B" },
      ],
      { states: ["A", "B"], initial: "A", terminal: ["B"] },
    );
    expect(loop.can("A", "A")).toBe(true);
    expect(() => loop.assert("A", "A")).not.toThrow();
  });

  it("rejects unknown states in can and assert", () => {
    const machine = createWorkMachine();

    expect(machine.can("UNKNOWN", "DRAFT")).toBe(false);
    expect(machine.can("DRAFT", "UNKNOWN")).toBe(false);
    expect(() => machine.assert("UNKNOWN", "DRAFT")).toThrow(AppError);
  });

  it("rejects duplicate state declarations", () => {
    expect(
      () =>
        new StateMachine("duplicate", [{ from: "A", to: "B" }], {
          states: ["A", "A", "B"],
          initial: "A",
          terminal: ["B"],
        }),
    ).toThrow(/duplicate states/);
  });

  it("rejects a missing initial state", () => {
    expect(
      () =>
        new StateMachine("missing-initial", [{ from: "A", to: "B" }], {
          states: ["A", "B"],
          initial: "C",
          terminal: ["B"],
        }),
    ).toThrow(/initial state C is not declared/);
  });

  it("rejects undeclared terminal states", () => {
    expect(
      () =>
        new StateMachine("bad-terminal", [{ from: "A", to: "B" }], {
          states: ["A", "B"],
          initial: "A",
          terminal: ["C"],
        }),
    ).toThrow(/terminal state C is not declared/);
  });

  it("rejects transitions that reference unknown states", () => {
    expect(
      () =>
        new StateMachine("unknown-target", [{ from: "A", to: "C" }], {
          states: ["A", "B"],
          initial: "A",
          terminal: ["B"],
        }),
    ).toThrow(/unknown state C/);
  });

  it("rejects transitions leaving a terminal state", () => {
    expect(
      () =>
        new StateMachine(
          "terminal-exit",
          [
            { from: "A", to: "B" },
            { from: "B", to: "C" },
          ],
          { states: ["A", "B", "C"], initial: "A", terminal: ["B", "C"] },
        ),
    ).toThrow(/terminal state B cannot transition/);
  });

  it("rejects duplicate transitions", () => {
    expect(
      () =>
        new StateMachine(
          "duplicate-transition",
          [
            { from: "A", to: "B" },
            { from: "A", to: "B" },
          ],
          { states: ["A", "B"], initial: "A", terminal: ["B"] },
        ),
    ).toThrow(/duplicate transition/);
  });

  it("rejects non-terminal dead-end states", () => {
    expect(
      () =>
        new StateMachine("dead-end", [{ from: "A", to: "B" }], {
          states: ["A", "B", "C"],
          initial: "A",
          terminal: ["C"],
        }),
    ).toThrow(/neither terminal nor able to transition/);
  });

  it("rejects non-terminal states that only loop to themselves", () => {
    expect(
      () =>
        new StateMachine("trap", [{ from: "A", to: "A" }], {
          states: ["A", "B"],
          initial: "A",
          terminal: ["B"],
        }),
    ).toThrow(/only permits a self transition/);
  });

  it("rejects states unreachable from the initial state", () => {
    expect(
      () =>
        new StateMachine("unreachable", [{ from: "A", to: "B" }], {
          states: ["A", "B", "C"],
          initial: "A",
          terminal: ["B", "C"],
        }),
    ).toThrow(/state C is unreachable/);
  });

  it("rejects states that cannot reach a terminal state", () => {
    expect(
      () =>
        new StateMachine(
          "no-terminal-path",
          [
            { from: "A", to: "B" },
            { from: "A", to: "C" },
            { from: "B", to: "D" },
            { from: "D", to: "B" },
          ],
          { states: ["A", "B", "C", "D"], initial: "A", terminal: ["C"] },
        ),
    ).toThrow(/cannot reach a terminal state/);
  });

  it("requires at least one terminal state", () => {
    expect(
      () =>
        new StateMachine(
          "no-terminal",
          [
            { from: "A", to: "B" },
            { from: "B", to: "A" },
          ],
          { states: ["A", "B"], initial: "A" },
        ),
    ).toThrow(/must declare at least one terminal state/);
  });

  it("rejects malformed constructor arguments", () => {
    expect(
      () =>
        new StateMachine(
          "missing-opts",
          [],
          null as unknown as { states: string[]; initial: string },
        ),
    ).toThrow(/options must be an object/);

    expect(
      () =>
        new StateMachine(
          "missing-transitions",
          undefined as unknown as Transition[],
          { states: ["A"], initial: "A", terminal: ["A"] },
        ),
    ).toThrow(/transitions must be an array/);

    expect(
      () =>
        new StateMachine(
          "bad-state-name",
          [],
          { states: [""], initial: "", terminal: [""] },
        ),
    ).toThrow(/state names must be non-empty strings/);

    expect(
      () =>
        new StateMachine(
          "bad-transition-shape",
          [{ from: 1, to: "B" } as unknown as Transition],
          { states: ["A", "B"], initial: "A", terminal: ["B"] },
        ),
    ).toThrow(/string from\/to values/);

    expect(
      () =>
        new StateMachine("duplicate-terminal", [{ from: "A", to: "B" }], {
          states: ["A", "B"],
          initial: "A",
          terminal: ["B", "B"],
        }),
    ).toThrow(/duplicate terminal states/);

    expect(
      () =>
        new StateMachine("bad-terminal-list", [{ from: "A", to: "B" }], {
          states: ["A", "B"],
          initial: "A",
          terminal: "B" as unknown as string[],
        }),
    ).toThrow(/terminal states must be non-empty strings/);
  });
});

describe("built-in state machines", () => {
  it("builds valid mission, task, and deployment machines", () => {
    expect(missionMachine.initial).toBe("DRAFT");
    expect(taskMachine.initial).toBe("DRAFT");
    expect(deploymentMachine.initial).toBe("PENDING");
    expect(missionMachine.isTerminal("COMPLETED")).toBe(true);
    expect(taskMachine.isTerminal("DONE")).toBe(true);
  });

  it("matches the complete mission transition table", () => {
    const expected: Record<string, string[]> = {
      DRAFT: ["DISCOVERY", "CANCELLED"],
      DISCOVERY: ["REQUIREMENTS", "CANCELLED"],
      REQUIREMENTS: ["ARCHITECTURE", "CANCELLED"],
      ARCHITECTURE: ["READY", "CANCELLED"],
      READY: ["PLANNED", "CANCELLED"],
      PLANNED: ["IN_PROGRESS", "CANCELLED"],
      IN_PROGRESS: ["REVIEW", "BLOCKED", "FAILED"],
      REVIEW: ["QA", "IN_PROGRESS"],
      QA: ["SECURITY", "IN_PROGRESS"],
      SECURITY: ["APPROVAL", "IN_PROGRESS"],
      APPROVAL: ["COMPLETED", "IN_PROGRESS"],
      BLOCKED: ["IN_PROGRESS", "CANCELLED"],
      FAILED: ["IN_PROGRESS"],
      COMPLETED: [],
      CANCELLED: [],
    };

    for (const from of MISSION_STATES) {
      expect(missionMachine.nextStates(from)).toEqual(expected[from]);
      for (const to of MISSION_STATES) {
        expect(missionMachine.can(from, to)).toBe(expected[from]!.includes(to));
      }
    }
  });

  it("matches the complete task transition table", () => {
    const expected: Record<string, string[]> = {
      DRAFT: ["READY", "CANCELLED"],
      READY: ["PLANNED", "CANCELLED"],
      PLANNED: ["ASSIGNED", "CANCELLED"],
      ASSIGNED: ["IN_PROGRESS", "CANCELLED"],
      IN_PROGRESS: ["REVIEW", "BLOCKED", "FAILED", "CANCELLED"],
      REVIEW: ["QA", "IN_PROGRESS"],
      QA: ["SECURITY", "IN_PROGRESS"],
      SECURITY: ["DONE", "IN_PROGRESS"],
      BLOCKED: ["IN_PROGRESS"],
      FAILED: ["IN_PROGRESS"],
      DONE: [],
      CANCELLED: [],
    };

    for (const from of TASK_STATES) {
      expect(taskMachine.nextStates(from)).toEqual(expected[from]);
      for (const to of TASK_STATES) {
        expect(taskMachine.can(from, to)).toBe(expected[from]!.includes(to));
      }
    }
  });

  it("matches the complete deployment transition table", () => {
    const expected: Record<string, string[]> = {
      PENDING: ["BUILDING", "CANCELLED"],
      BUILDING: ["DEPLOYING", "CANCELLED", "FAILED"],
      DEPLOYING: ["SUCCEEDED", "FAILED"],
      SUCCEEDED: ["ROLLED_BACK"],
      FAILED: ["BUILDING", "CANCELLED"],
      ROLLED_BACK: [],
      CANCELLED: [],
    };

    for (const from of DEPLOYMENT_STATES) {
      expect(deploymentMachine.nextStates(from)).toEqual(expected[from]);
      for (const to of DEPLOYMENT_STATES) {
        expect(deploymentMachine.can(from, to)).toBe(expected[from]!.includes(to));
      }
    }
  });

  it("treats a successfully deployed release as rollback-capable, not terminal", () => {
    expect(deploymentMachine.isTerminal("SUCCEEDED")).toBe(false);
    expect(deploymentMachine.can("SUCCEEDED", "ROLLED_BACK")).toBe(true);
    expect(deploymentMachine.isTerminal("ROLLED_BACK")).toBe(true);
  });

  it("allows a failed deployment to be retried or cancelled", () => {
    expect(deploymentMachine.can("FAILED", "BUILDING")).toBe(true);
    expect(deploymentMachine.can("FAILED", "CANCELLED")).toBe(true);
  });

  it("does not allow terminal states to transition", () => {
    expect(missionMachine.can("COMPLETED", "IN_PROGRESS")).toBe(false);
    expect(taskMachine.can("DONE", "IN_PROGRESS")).toBe(false);
    expect(deploymentMachine.can("CANCELLED", "PENDING")).toBe(false);
  });
});
