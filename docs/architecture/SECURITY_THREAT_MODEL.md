# Security Threat Model: Core Package and API Foundation

Status: covers `packages/core` and the local `apps/api` foundation. There is no agent runtime, tool execution, external provider integration, or production deployment in this repository. This model does not certify those future systems.

## Assets

- Integrity of mission, task, and deployment lifecycle transitions.
- Integrity and traceability of domain-event envelopes and the durable event log.
- Tenant isolation of missions, tasks, and events.
- Bearer-token confidentiality and revocation.
- Integrity of the SQLite database and its local backups.
- Stable error semantics without leaking stack traces or causes.
- Unpredictable identifiers and valid display codes.
- Build and test supply chain.
- Absence of credentials in source and examples.

## Trust boundaries

| Boundary | Trusted side | Untrusted side |
| --- | --- | --- |
| HTTP client to API | Authenticated tenant derived from a token | Headers, paths, query strings, JSON bodies, request ids |
| Authentication to authorization | API token record and role scopes | Claimed tenant ids, roles, or scopes in request content |
| Repository to SQLite | Parameterized SQL and tenant predicates | User-controlled values in titles, reasons, ids, and filters |
| Core library caller | Application code and typed configuration | Runtime values, deserialized payloads, future APIs |
| Event envelope | Declared `EventTypes` and envelope schema | Event payload content and externally supplied timestamps/identifiers |
| Error serialization | `AppError` metadata intended for clients | `details`, `cause`, stack traces, and provider messages |
| Database file and backup | Process/filesystem access controls | Other local users, copied backups, unencrypted storage |
| Dependency installation | Lockfile-resolved packages | Registry packages, install scripts, advisory drift |
| Future consumers | Validated core values | Raw payloads that a future agent/tool layer might treat as instructions |

## Threats and mitigations

### T1: Forged or undeclared lifecycle transition

Threat: a caller records a transition the graph does not permit, including an undeclared self transition, an exit from a terminal state, or a stale race.

Mitigation: `StateMachine` validates the graph at construction. The API runs `missionMachine.assert` or `taskMachine.assert` inside a `BEGIN IMMEDIATE` transaction and updates with an `expectedVersion` predicate. Invalid transitions return `409 INVALID_TRANSITION`; stale versions return `409 CONFLICT`.

Residual risk: database operators can bypass the API and write directly. SQLite does not encode the transition graph as a constraint.

### T2: Malformed or forged domain event

Threat: a typo, unknown event type, invalid timestamp, or non-object payload enters an audit stream.

Mitigation: `createEvent` validates payloads and actor type; `isDomainEvent` and `assertDomainEvent` validate the envelope and event type; `EventTypes` is frozen. Events are written in the same transaction as the state change and are revalidated when read.

Residual risk: there is no event signature, producer authentication, deduplication, or immutable/WORM store. A future event bus must authenticate producers and make consumers idempotent.

### T3: Sensitive data in errors

Threat: stack traces, causes, provider messages, or `details` leak credentials or internal state to clients or logs.

Mitigation: `toJSON` excludes stack and cause. The API returns a stable error envelope, strips details for `INTERNAL`, and never returns stack traces. Authorization headers are redacted from logs. Client-supplied request ids are ignored; the server generates UUID request ids.

Residual risk: callers can put secrets in `message` or `details`. Validation details include field paths and messages. Logging pipelines must not log request bodies or event payloads.

### T4: Identifier collision or predictability

Threat: predictable identifiers enable enumeration; weak hashes create collisions in display keys.

Mitigation: identifiers use `crypto.randomUUID`; short hashes use truncated SHA-256; code prefixes and sequences are validated.

Residual risk: `shortHash` is an identifier helper, not a password hash or signature. Uniqueness still depends on the calling store.

### T5: Retry amplification and duplicate side effects

Threat: callers retry internal, non-idempotent failures and duplicate writes or external actions.

Mitigation: `INTERNAL` is not retryable; transient provider, timeout, rate-limit, circuit, and sandbox errors are marked retryable. Mission/task transitions are optimistic and conflict on stale versions. Create and transition routes accept tenant-, token-, operation-, and request-hash-scoped `Idempotency-Key` values with a 24-hour replay window. The core package exposes a retry/backoff helper with jitter and `Retry-After` parsing.

Residual risk: idempotency covers API create/transition writes only. Failed attempts are not stored, keys expire after 24 hours, and no worker applies retries automatically.

### T6: Vulnerable or malicious development dependencies

Threat: test tooling or install scripts execute unwanted code or read local files.

Mitigation: lockfile-based installs; `npm ci --ignore-scripts` in CI; SHA-pinned actions; read-only CI permissions; `npm audit` reports 0 vulnerabilities; CI includes a high-severity audit gate.

Residual risk: no SBOM or provenance exists, and advisory data changes over time.

### T7: Credentials committed to source

Threat: example configuration or test data is copied into a deployment with predictable secrets.

Mitigation: `.env.example` contains only non-secret local API settings; `.gitignore` excludes `.env` files and local databases; test tokens are generated at runtime; `SECURITY.md` defines private reporting.

Residual risk: no secret scanner runs in CI, and no secret manager or automatic rotation exists.

### T8: Untrusted payload promoted to instruction

Threat: a future consumer treats mission, task, or event text as an instruction or policy.

Mitigation: the core package and API treat payloads as data and perform no execution, interpolation, or policy evaluation. The four API event types use strict, allowlisted payload schemas that reject missing, malformed, and undeclared fields.

Residual risk: this boundary must be preserved by future agent and tool layers. Core validation alone cannot prevent prompt injection or tool misuse.

### T9: Bearer-token theft or replay

Threat: a token is copied from logs, backups, process memory, or a client and used by another party.

Mitigation: tokens are 256-bit random values; only SHA-256 hashes are stored; authorization headers are redacted; tokens expire after 30 days by default and can be revoked; the API binds to loopback by default and disables proxy trust; authenticated requests are rate-limited per token.

Residual risk: the local API does not terminate TLS, rate-limit authentication failures, support MFA, or provide token renewal/rotation APIs. A stolen unexpired token remains valid until revoked.

### T10: Cross-tenant object access

Threat: a caller reads or mutates another tenant's mission, task, or event by guessing or obtaining an id.

Mitigation: tenant ids come only from the authenticated token. Every query includes `tenant_id`; composite foreign keys bind tasks to tenant-owned missions; cross-tenant object reads return `404`. Integration tests cover reads, lists, transitions, task creation, and events.

Residual risk: isolation is enforced by application predicates, not database row-level security. A future multi-tenant database needs RLS or equivalent defense in depth.

### T11: SQL injection or unsafe query construction

Threat: request values alter SQL structure or bypass tenant filters.

Mitigation: all values are bound parameters. Dynamic SQL is limited to fixed condition strings and fixed table names (`missions` and `tasks`). Zod validates UUIDs, enums, and numeric bounds before repository calls.

Residual risk: future dynamic filters and migrations must preserve parameterization and tenant predicates.

### T12: Database or backup exposure

Threat: a local user, copied backup, or stolen disk exposes tenant data, token hashes, and event history.

Mitigation: database files are ignored by git; the API avoids exposing the file over HTTP; SQLite extension loading is disabled and `trusted_schema` is off; backups use the SQLite online backup API, are integrity-checked, support retention pruning, and have a repeatable restore drill. The runbook requires backups to receive the same access controls as the live database.

Residual risk: no encryption at rest, off-host replication, backup scheduler, or key management exists. Token hashes are not password hashes; tokens still have 256 bits of entropy.

### T13: Request flooding or resource exhaustion

Threat: a client sends large or slow requests, exhausts synchronous SQLite work, or creates unbounded rows.

Mitigation: 64 KiB body limit, 15-second request timeout, bounded title/description/reason lengths, pagination caps, and a per-token fixed-window rate limit (120 requests per 60 seconds by default) with `429` and `Retry-After`.

Residual risk: rate-limit state is in memory and per process, so it resets on restart and is not shared across replicas. Authentication failures are not rate-limited. There are no connection limits, backpressure controls, or per-tenant quotas. The API is single-process and SQLite operations are synchronous.

## Out of scope

- Production identity providers, password/session/MFA flows, and token-management APIs.
- Model providers, prompt injection, retrieval poisoning, and agent tool abuse.
- Containers, infrastructure, network perimeter, WAF, DDoS protection, and deployment.
- Scheduled or off-host backup, disaster recovery, encryption at rest, and key management.
- Legal, privacy, and regulatory obligations.

## Evidence

- `packages/core/src/errors.ts`
- `packages/core/src/events.ts`
- `packages/core/src/ids.ts`
- `packages/core/src/state-machine.ts`
- `apps/api/src/auth.ts`
- `apps/api/src/backup-lib.ts`
- `apps/api/src/db.ts`
- `apps/api/src/idempotency.ts`
- `apps/api/src/metrics.ts`
- `apps/api/src/rate-limit.ts`
- `apps/api/src/repository.ts`
- `apps/api/src/server.ts`
- `apps/api/src/trace.ts`
- `packages/core/src/retry.ts`
- `tests/unit/`
- `tests/integration/api.test.ts`
- `tests/integration/backup.test.ts`
- `docs/operations/RUNBOOK.md`
- `docs/audit/API_FOUNDATION_VERIFICATION.md`
