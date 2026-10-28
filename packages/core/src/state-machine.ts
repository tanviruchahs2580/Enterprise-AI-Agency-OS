import { AppError } from "./errors.js";

export type Transition = { from: string; to: string };

export type StateMachineOptions = {
  states: readonly string[];
  initial: string;
  terminal?: readonly string[];
};

export class StateMachine {
  readonly entity: string;
  readonly initial: string;
  readonly states: ReadonlySet<string>;
  readonly terminalStates: ReadonlySet<string>;
  private readonly allowed: Map<string, ReadonlySet<string>>;

  constructor(
    entity: string,
    transitions: readonly Transition[],
    opts: StateMachineOptions,
  ) {
    if (typeof entity !== "string" || entity.trim() === "") {
      throw AppError.validation("State machine entity must be a non-empty string");
    }
    if (opts === null || typeof opts !== "object" || Array.isArray(opts)) {
      throw AppError.validation(`State machine ${entity} options must be an object`);
    }
    if (!Array.isArray(transitions)) {
      throw AppError.validation(`State machine ${entity} transitions must be an array`);
    }
    if (!Array.isArray(opts.states) || opts.states.length === 0) {
      throw AppError.validation(`State machine ${entity} must declare at least one state`);
    }
    for (const state of opts.states) {
      if (typeof state !== "string" || state.trim() === "") {
        throw AppError.validation(
          `State machine ${entity} state names must be non-empty strings`,
        );
      }
    }
    if (typeof opts.initial !== "string" || opts.initial.trim() === "") {
      throw AppError.validation(
        `State machine ${entity} initial state must be a non-empty string`,
      );
    }

    const states = new Set(opts.states);
    if (states.size !== opts.states.length) {
      throw AppError.validation(`State machine ${entity} declares duplicate states`);
    }
    if (!states.has(opts.initial)) {
      throw AppError.validation(
        `State machine ${entity} initial state ${opts.initial} is not declared`,
      );
    }

    if (
      opts.terminal !== undefined &&
      (!Array.isArray(opts.terminal) ||
        opts.terminal.some(
          (state) => typeof state !== "string" || state.trim() === "",
        ))
    ) {
      throw AppError.validation(
        `State machine ${entity} terminal states must be non-empty strings`,
      );
    }
    const terminal = new Set(opts.terminal ?? []);
    if (opts.terminal !== undefined && terminal.size !== opts.terminal.length) {
      throw AppError.validation(
        `State machine ${entity} declares duplicate terminal states`,
      );
    }
    if (terminal.size === 0) {
      throw AppError.validation(
        `State machine ${entity} must declare at least one terminal state`,
      );
    }
    for (const state of terminal) {
      if (!states.has(state)) {
        throw AppError.validation(
          `State machine ${entity} terminal state ${state} is not declared`,
        );
      }
    }

    const outgoing = new Map<string, Set<string>>();
    for (const state of states) {
      outgoing.set(state, new Set());
    }

    for (const transition of transitions) {
      if (
        transition === null ||
        typeof transition !== "object" ||
        typeof transition.from !== "string" ||
        typeof transition.to !== "string"
      ) {
        throw AppError.validation(
          `State machine ${entity} transitions must contain string from/to values`,
        );
      }
      if (!states.has(transition.from)) {
        throw AppError.validation(
          `State machine ${entity} transition references unknown state ${transition.from}`,
        );
      }
      if (!states.has(transition.to)) {
        throw AppError.validation(
          `State machine ${entity} transition references unknown state ${transition.to}`,
        );
      }
      if (terminal.has(transition.from)) {
        throw AppError.validation(
          `State machine ${entity} terminal state ${transition.from} cannot transition`,
        );
      }

      const targets = outgoing.get(transition.from)!;
      if (targets.has(transition.to)) {
        throw AppError.validation(
          `State machine ${entity} declares duplicate transition ${transition.from} -> ${transition.to}`,
        );
      }
      targets.add(transition.to);
    }

    for (const state of states) {
      if (terminal.has(state)) continue;
      const targets = outgoing.get(state)!;
      if (targets.size === 0) {
        throw AppError.validation(
          `State machine ${entity} state ${state} is neither terminal nor able to transition`,
        );
      }
      if ([...targets].every((target) => target === state)) {
        throw AppError.validation(
          `State machine ${entity} state ${state} only permits a self transition`,
        );
      }
    }

    const reachable = new Set<string>([opts.initial]);
    const queue: string[] = [opts.initial];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of outgoing.get(current)!) {
        if (!reachable.has(next)) {
          reachable.add(next);
          queue.push(next);
        }
      }
    }
    for (const state of states) {
      if (!reachable.has(state)) {
        throw AppError.validation(
          `State machine ${entity} state ${state} is unreachable from ${opts.initial}`,
        );
      }
    }

    const reverse = new Map<string, Set<string>>();
    for (const state of states) {
      reverse.set(state, new Set());
    }
    for (const [from, targets] of outgoing) {
      for (const to of targets) {
        reverse.get(to)!.add(from);
      }
    }

    const canReachTerminal = new Set<string>(terminal);
    const terminalQueue: string[] = [...terminal];
    while (terminalQueue.length > 0) {
      const current = terminalQueue.shift()!;
      for (const previous of reverse.get(current)!) {
        if (!canReachTerminal.has(previous)) {
          canReachTerminal.add(previous);
          terminalQueue.push(previous);
        }
      }
    }

    for (const state of states) {
      if (!canReachTerminal.has(state)) {
        throw AppError.validation(
          `State machine ${entity} state ${state} cannot reach a terminal state`,
        );
      }
    }

    this.entity = entity;
    this.initial = opts.initial;
    this.states = states;
    this.terminalStates = terminal;
    this.allowed = new Map(
      [...outgoing].map(([state, targets]) => [state, new Set(targets)]),
    );
  }

  hasState(state: string): boolean {
    return this.states.has(state);
  }

  isTerminal(state: string): boolean {
    return this.terminalStates.has(state);
  }

  can(from: string, to: string): boolean {
    if (!this.states.has(from) || !this.states.has(to)) return false;
    return this.allowed.get(from)?.has(to) ?? false;
  }

  assert(from: string, to: string): void {
    if (!this.can(from, to)) {
      throw AppError.invalidTransition(from, to, this.entity);
    }
  }

  nextStates(from: string): readonly string[] {
    return [...(this.allowed.get(from) ?? [])];
  }
}

export const MISSION_STATES = [
  "DRAFT",
  "DISCOVERY",
  "REQUIREMENTS",
  "ARCHITECTURE",
  "READY",
  "PLANNED",
  "IN_PROGRESS",
  "REVIEW",
  "QA",
  "SECURITY",
  "APPROVAL",
  "COMPLETED",
  "BLOCKED",
  "FAILED",
  "CANCELLED",
] as const;
export type MissionState = (typeof MISSION_STATES)[number];

export const missionMachine = new StateMachine(
  "mission",
  [
    { from: "DRAFT", to: "DISCOVERY" },
    { from: "DISCOVERY", to: "REQUIREMENTS" },
    { from: "REQUIREMENTS", to: "ARCHITECTURE" },
    { from: "ARCHITECTURE", to: "READY" },
    { from: "READY", to: "PLANNED" },
    { from: "PLANNED", to: "IN_PROGRESS" },
    { from: "IN_PROGRESS", to: "REVIEW" },
    { from: "REVIEW", to: "QA" },
    { from: "REVIEW", to: "IN_PROGRESS" },
    { from: "QA", to: "SECURITY" },
    { from: "QA", to: "IN_PROGRESS" },
    { from: "SECURITY", to: "APPROVAL" },
    { from: "SECURITY", to: "IN_PROGRESS" },
    { from: "APPROVAL", to: "COMPLETED" },
    { from: "APPROVAL", to: "IN_PROGRESS" },
    { from: "DRAFT", to: "CANCELLED" },
    { from: "DISCOVERY", to: "CANCELLED" },
    { from: "REQUIREMENTS", to: "CANCELLED" },
    { from: "ARCHITECTURE", to: "CANCELLED" },
    { from: "READY", to: "CANCELLED" },
    { from: "PLANNED", to: "CANCELLED" },
    { from: "IN_PROGRESS", to: "BLOCKED" },
    { from: "BLOCKED", to: "IN_PROGRESS" },
    { from: "BLOCKED", to: "CANCELLED" },
    { from: "IN_PROGRESS", to: "FAILED" },
    { from: "FAILED", to: "IN_PROGRESS" },
  ],
  {
    states: MISSION_STATES,
    initial: "DRAFT",
    terminal: ["COMPLETED", "CANCELLED"],
  },
);

export const TASK_STATES = [
  "DRAFT",
  "READY",
  "PLANNED",
  "ASSIGNED",
  "IN_PROGRESS",
  "REVIEW",
  "QA",
  "SECURITY",
  "DONE",
  "BLOCKED",
  "FAILED",
  "CANCELLED",
] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const taskMachine = new StateMachine(
  "task",
  [
    { from: "DRAFT", to: "READY" },
    { from: "READY", to: "PLANNED" },
    { from: "PLANNED", to: "ASSIGNED" },
    { from: "ASSIGNED", to: "IN_PROGRESS" },
    { from: "IN_PROGRESS", to: "REVIEW" },
    { from: "IN_PROGRESS", to: "BLOCKED" },
    { from: "IN_PROGRESS", to: "FAILED" },
    { from: "IN_PROGRESS", to: "CANCELLED" },
    { from: "REVIEW", to: "QA" },
    { from: "REVIEW", to: "IN_PROGRESS" },
    { from: "QA", to: "SECURITY" },
    { from: "QA", to: "IN_PROGRESS" },
    { from: "SECURITY", to: "DONE" },
    { from: "SECURITY", to: "IN_PROGRESS" },
    { from: "BLOCKED", to: "IN_PROGRESS" },
    { from: "FAILED", to: "IN_PROGRESS" },
    { from: "DRAFT", to: "CANCELLED" },
    { from: "READY", to: "CANCELLED" },
    { from: "PLANNED", to: "CANCELLED" },
    { from: "ASSIGNED", to: "CANCELLED" },
  ],
  {
    states: TASK_STATES,
    initial: "DRAFT",
    terminal: ["DONE", "CANCELLED"],
  },
);

export const DEPLOYMENT_STATES = [
  "PENDING",
  "BUILDING",
  "DEPLOYING",
  "SUCCEEDED",
  "FAILED",
  "ROLLED_BACK",
  "CANCELLED",
] as const;
export type DeploymentState = (typeof DEPLOYMENT_STATES)[number];

export const deploymentMachine = new StateMachine(
  "deployment",
  [
    { from: "PENDING", to: "BUILDING" },
    { from: "BUILDING", to: "DEPLOYING" },
    { from: "DEPLOYING", to: "SUCCEEDED" },
    { from: "DEPLOYING", to: "FAILED" },
    { from: "SUCCEEDED", to: "ROLLED_BACK" },
    { from: "PENDING", to: "CANCELLED" },
    { from: "BUILDING", to: "CANCELLED" },
    { from: "BUILDING", to: "FAILED" },
    { from: "FAILED", to: "BUILDING" },
    { from: "FAILED", to: "CANCELLED" },
  ],
  {
    states: DEPLOYMENT_STATES,
    initial: "PENDING",
    terminal: ["ROLLED_BACK", "CANCELLED"],
  },
);
