# ADR-001: Enforce state-machine invariants in the core package

Status: accepted
Date: 2026-10-22

## Context

The core state machine accepted arbitrary state names, silently allowed any self transition, did not reject transitions out of terminal states, and threw a plain `Error` for invalid transitions. The deployment machine declared `SUCCEEDED` as terminal while also allowing `SUCCEEDED -> ROLLED_BACK`, and `FAILED` had no outgoing transition.

These behaviors undermine lifecycle gates before any API or orchestrator exists. A typo in a transition or an undeclared state would not fail fast. A caller could treat a self transition as valid even when the workflow never declared it. API layers could not map transition failures to a stable error contract.

## Decision

The `StateMachine` constructor now validates its complete graph:

- every state is declared, unique, and reachable from the initial state;
- at least one terminal state is declared, and terminal states cannot transition;
- every state can reach a terminal state;
- transitions reference declared states and are unique;
- non-terminal states must have a non-self outgoing path;
- self transitions are valid only when declared explicitly.

Invalid transitions throw `AppError` with code `INVALID_TRANSITION` and status 409. The deployment machine now treats `SUCCEEDED` as rollback-capable rather than terminal, and `FAILED` can be retried or cancelled.

## Alternatives considered

- Keep permissive construction and rely on callers to validate transitions. Rejected: it moves a core safety invariant into every caller.
- Treat all self transitions as no-ops. Rejected: it hides undeclared lifecycle behavior and makes audit output ambiguous.
- Mark `FAILED` as terminal. Rejected: it prevents safe retry or cancellation recovery.

## Consequences

- A malformed machine fails at module load rather than at runtime.
- Adding a state or transition now requires an intentional graph update.
- Consumers that relied on implicit self transitions must declare them.
- The core package has a stable transition error contract that the API maps to `409 INVALID_TRANSITION`.
- The API foundation now implements durable mission/task transitions, token authorization, and audit events. Approvals and separation of duties remain unimplemented release gates.

## Evidence

- `packages/core/src/state-machine.ts`
- `tests/unit/state-machine.test.ts`
- `tests/unit/errors.test.ts`
- `apps/api/src/repository.ts`
- `tests/integration/api.test.ts`
