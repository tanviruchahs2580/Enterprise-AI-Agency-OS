# Enterprise AI Agency OS

Status: early local foundation. This repository contains shared TypeScript contracts, an authenticated mission/task API, and local SQLite persistence. It is not a runnable agency platform and is not production-ready.

## Verified scope

Implemented and tested:

- Typed application errors with HTTP status, retry classification, and JSON serialization that excludes stack traces and causes. Caller-supplied details and messages are serialized unchanged.
- Mission, task, and deployment state machines with graph validation and explicit terminal-state rules.
- Versioned domain-event envelopes with runtime validation and strict payload schemas for mission and task events.
- Identifier helpers, zero-padded codes, and SHA-256 based short hashes.
- Retry/backoff helpers with retryability classification and `Retry-After` parsing.
- A buildable `@agency/core` workspace package.
- A Fastify API with bearer-token authentication, role scopes, tenant-scoped queries, request validation, health/readiness endpoints, and structured errors.
- Mission and task creation plus transactional state transitions with optimistic version checks and durable mission/task events.
- Optional tenant- and token-scoped idempotency keys with 24-hour replay for create and transition writes.
- Per-token in-memory rate limiting with standard rate-limit headers and `429`/`Retry-After` responses.
- Token expiry (30-day default) alongside revocation, plus `whoami` expiry reporting.
- Tenant-scoped audit export in JSON or NDJSON.
- Prometheus text metrics, W3C trace-context propagation, and request/trace correlation headers.
- SQLite persistence with foreign keys, migrations, WAL, strict tables, restart recovery, automated online backup, and a restore drill.
- 104 unit and integration tests, including tenant isolation, denied transitions, scope failures, stale versions, idempotency replay/conflicts and restart persistence, token expiry, rate limiting, audit export, metrics/traces, schema migration, restart recovery, and backup/restore.

Not implemented:

- Worker, agent registry, orchestration, tool/MCP execution, approvals, budgets, sandboxing, or model-provider adapters.
- Password/session/MFA/OIDC flows or a token-management API beyond provisioning, expiry, and revocation.
- Dashboard, product CLI, distributed observability pipeline, deployment, encryption at rest, or production operational controls.
- Event producer authentication, event signatures, consumer delivery guarantees, or a tamper-evident audit chain.
- Contract, end-to-end, browser, load, or tool-execution test suites.

The repository is published on `main`; the verified code revision is `99484db`. CI passes on GitHub Actions, and branch protection requires the `verify` check. There is no release or deployment.

## Requirements

- Node.js 24 LTS or 26 or newer. Node 22 is not supported because the API uses the built-in `node:sqlite` module.
- npm 10 or newer.

## Quick start

```bash
npm ci --ignore-scripts
npm run verify
```

Provision a tenant and print its token once:

```bash
npm run provision --workspace @agency/api -- --db .data/agency.db --tenant "Local" --role ADMIN
```

Start the API:

```bash
DATABASE_PATH=.data/agency.db npm run start:api
```

On PowerShell:

```powershell
$env:DATABASE_PATH = ".data/agency.db"
npm run start:api
```

The API listens on `127.0.0.1:3000` by default. Send the token as `Authorization: Bearer <token>`.

## API

| Method | Path | Required scope | Purpose |
| --- | --- | --- | --- |
| GET | `/healthz` | none | Liveness |
| GET | `/readyz` | none | Database readiness |
| GET | `/v1/whoami` | authenticated | Caller identity and scopes |
| POST | `/v1/missions` | `missions:write` | Create a mission |
| GET | `/v1/missions` | `missions:read` | List missions |
| GET | `/v1/missions/:missionId` | `missions:read` | Read a mission |
| POST | `/v1/missions/:missionId/transitions` | `missions:write` | Transition a mission |
| POST | `/v1/missions/:missionId/tasks` | `tasks:write` | Create a task |
| GET | `/v1/missions/:missionId/tasks` | `tasks:read` | List mission tasks |
| GET | `/v1/tasks/:taskId` | `tasks:read` | Read a task |
| POST | `/v1/tasks/:taskId/transitions` | `tasks:write` | Transition a task |
| GET | `/v1/events` | `events:read` | List durable domain events |
| GET | `/v1/audit/export` | `events:read` | Export tenant audit events as JSON or NDJSON |
| GET | `/v1/metrics` | `events:read` + `ADMIN` | Prometheus text metrics |

See `docs/api/API.md` for request shapes, scopes, errors, and limitations. See `docs/operations/RUNBOOK.md` for local operation and backup guidance.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run lint` | ESLint over the repository |
| `npm run typecheck` | Strict TypeScript check without emit |
| `npm test` | Vitest unit and integration tests |
| `npm run build` | Build `@agency/core` and `@agency/api` |
| `npm run smoke` | Import the built core package and exercise core contracts |
| `npm run verify` | Lint, typecheck, test, build, and smoke |
| `npm run start:api` | Start the built API |
| `npm run provision` | Create a tenant and issue a token |
| `npm run revoke` | Revoke an issued token |
| `npm run backup` | Create a verified online SQLite backup (run `npm run build` first) |
| `npm run restore:drill` | Restore a backup into a temporary database and verify it |

## Layout

```text
packages/core/src/                  typed errors, events, identifiers, state machines
apps/api/src/                       Fastify API, auth, SQLite persistence, provisioning
tests/unit/                         core contract tests
tests/integration/                  API, isolation, and persistence tests
docs/api/                           API contract and examples
docs/operations/                    local runbook
docs/audit/                         audit and verification evidence
docs/architecture/                  state-machine and threat-model documentation
docs/decisions/                     architecture decision records
```

## State-machine semantics

A state machine must declare every state, its initial state, and at least one terminal state. Construction fails on duplicate, unknown, unreachable, dead-end, self-only trap, or non-terminating cycle states. Every state must be able to reach a terminal state. Terminal states cannot transition. A self transition is permitted only when declared explicitly. Invalid transitions raise `AppError` with code `INVALID_TRANSITION` and HTTP status 409.

Transitions are durable and version-checked. The client must send the current `expectedVersion`; a stale version returns `409 CONFLICT`.

## Security

- API tokens are random 256-bit bearer credentials. Only a SHA-256 hash is stored. Tokens expire after 30 days by default and can be revoked.
- Every data query is scoped by the authenticated tenant. Cross-tenant object access returns `404`.
- Scopes are default-deny: `ADMIN` and `OPERATOR` can write; `VIEWER` is read-only.
- Authenticated requests are rate-limited per token. The limiter is process-local.
- Idempotency records are tenant-, token-, and request-hash-scoped; a conflicting reuse returns `409`.
- The API binds to loopback by default and disables proxy trust.
- Request bodies are limited to 64 KiB; authorization headers are redacted from logs.
- Trace ids are propagated through `traceparent`/`x-trace-id`; request ids are returned as `x-request-id`.
- `.env.example` contains only non-secret local API settings. Report vulnerabilities through GitHub security advisories rather than public issues. See `SECURITY.md`.

SQLite is a local persistence adapter. It has no encryption at rest, high availability, or multi-node coordination. Automated online backups and a restore drill exist, but there is no scheduler, off-host retention, or encryption. Do not expose this API to untrusted networks without adding TLS, distributed rate limiting, secret management, and an external database.

## Release status

`NOT READY`

The applicable release gates are not satisfied because the repository has no worker, agent runtime, tool execution, approvals, budgets, deployment controls, distributed observability, or production database operations. Basic metrics, traces, audit export, and backup tooling exist, but they are local-only. CI and branch protection are recorded in `API_FOUNDATION_VERIFICATION.md`. See:

- `docs/audit/ENTERPRISE_ENGINEERING_AUDIT.md`
- `docs/audit/REQUIREMENTS_EVIDENCE_MATRIX.md`
- `docs/audit/API_FOUNDATION_VERIFICATION.md`
- `docs/architecture/SECURITY_THREAT_MODEL.md`
