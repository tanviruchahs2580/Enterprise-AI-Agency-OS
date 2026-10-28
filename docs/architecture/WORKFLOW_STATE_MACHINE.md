# Workflow State Machine

Status: the state graphs are implemented in `packages/core/src/state-machine.ts` and covered by unit tests. Mission and task transitions are enforced by the local API with durable SQLite state and events. Deployment transitions remain design-only; there is no orchestrator or approval service.

## Invariants enforced at construction

- The entity name is non-empty.
- At least one state is declared.
- State names are unique.
- The initial state is declared.
- At least one terminal state is declared, and terminal states cannot have outgoing transitions.
- Every transition references declared states.
- Duplicate transitions are rejected.
- Every non-terminal state has an outgoing transition.
- A non-terminal state cannot have only a self transition.
- Every state is reachable from the initial state.
- Every state can reach at least one terminal state. Closed cycles and other non-terminating paths are rejected.

## Runtime behavior

- `can(from, to)` returns `false` for unknown states or undeclared transitions.
- `assert(from, to)` throws `AppError` with code `INVALID_TRANSITION` and status 409.
- A self transition is allowed only when declared explicitly.
- `nextStates(from)` returns the declared outgoing targets.
- `isTerminal(state)` reports whether a state is terminal.

## Mission states

Initial: `DRAFT`

Terminal: `COMPLETED`, `CANCELLED`

| From | Allowed to |
| --- | --- |
| DRAFT | DISCOVERY, CANCELLED |
| DISCOVERY | REQUIREMENTS, CANCELLED |
| REQUIREMENTS | ARCHITECTURE, CANCELLED |
| ARCHITECTURE | READY, CANCELLED |
| READY | PLANNED, CANCELLED |
| PLANNED | IN_PROGRESS, CANCELLED |
| IN_PROGRESS | REVIEW, BLOCKED, FAILED |
| REVIEW | QA, IN_PROGRESS |
| QA | SECURITY, IN_PROGRESS |
| SECURITY | APPROVAL, IN_PROGRESS |
| APPROVAL | COMPLETED, IN_PROGRESS |
| BLOCKED | IN_PROGRESS, CANCELLED |
| FAILED | IN_PROGRESS |
| COMPLETED | none |
| CANCELLED | none |

## Task states

Initial: `DRAFT`

Terminal: `DONE`, `CANCELLED`

| From | Allowed to |
| --- | --- |
| DRAFT | READY, CANCELLED |
| READY | PLANNED, CANCELLED |
| PLANNED | ASSIGNED, CANCELLED |
| ASSIGNED | IN_PROGRESS, CANCELLED |
| IN_PROGRESS | REVIEW, BLOCKED, FAILED, CANCELLED |
| REVIEW | QA, IN_PROGRESS |
| QA | SECURITY, IN_PROGRESS |
| SECURITY | DONE, IN_PROGRESS |
| BLOCKED | IN_PROGRESS |
| FAILED | IN_PROGRESS |
| DONE | none |
| CANCELLED | none |

## Deployment states

Initial: `PENDING`

Terminal: `ROLLED_BACK`, `CANCELLED`

| From | Allowed to |
| --- | --- |
| PENDING | BUILDING, CANCELLED |
| BUILDING | DEPLOYING, FAILED, CANCELLED |
| DEPLOYING | SUCCEEDED, FAILED |
| SUCCEEDED | ROLLED_BACK |
| FAILED | BUILDING, CANCELLED |
| ROLLED_BACK | none |
| CANCELLED | none |

`SUCCEEDED` is intentionally not terminal so a successful deployment can be rolled back. A failed deployment can be retried or cancelled instead of becoming a dead end.

## API runtime enforcement

- Mission and task transitions run inside `BEGIN IMMEDIATE` transactions.
- The client must send the current `expectedVersion`; stale writes return `409 CONFLICT`.
- Invalid graph transitions return `409 INVALID_TRANSITION`.
- Every successful transition writes a durable event with the token actor and request correlation id.
- Create and transition requests accept an optional durable `Idempotency-Key` with a 24-hour replay window and conflict detection.
- Terminal missions reject new tasks. Task transitions are not yet coupled to mission terminal state.
- Deployment transitions are not exposed by the API.

## What is not implemented

- Human identity, approval binding, and separation of duties.
- Timeouts, automatic retries, cancellation, and recovery for long-running work. A core retry/backoff helper exists, but no worker applies it.
- Scheduling, orchestration, or agent assignment.
- Durable deployment transitions.

Those controls belong to future worker, approval, and orchestration layers and must be enforced in code with tests, not only documented.

## Evidence

- `packages/core/src/state-machine.ts`
- `tests/unit/state-machine.test.ts`
- `apps/api/src/idempotency.ts`
- `apps/api/src/repository.ts`
- `apps/api/src/server.ts`
- `tests/integration/api.test.ts`
- `docs/audit/ENTERPRISE_ENGINEERING_AUDIT.md`
