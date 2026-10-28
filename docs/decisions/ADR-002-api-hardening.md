# ADR-002: Local API hardening and recovery controls

Status: accepted
Date: 2026-10-28

## Context

The API foundation had authenticated, tenant-scoped mission and task writes, but it lacked controls expected before any shared or production use: safe retries, write de-duplication, abuse limits, token expiry, an audit export, operational metrics, and a verified recovery path. Adding these controls to a single-process SQLite service required decisions that keep the local implementation honest without implying production readiness.

## Decision

1. **Idempotency is opt-in and durable.** `POST` create and transition routes accept an optional `Idempotency-Key`. Records are scoped by tenant, token, operation, and a canonical SHA-256 hash of the request body. Successful `2xx` responses are stored for 24 hours and replayed with `idempotency-replayed: true`. A conflicting reuse returns `409 CONFLICT`. Failed attempts are not stored so callers can retry them.
2. **Retry policy is a core helper, not an automatic worker.** `packages/core/src/retry.ts` provides bounded exponential backoff, optional full jitter, retryability predicates, and `Retry-After` parsing. No worker or scheduler applies it automatically yet.
3. **Rate limiting is per token and in memory.** A fixed-window limiter returns `x-ratelimit-*` headers and `429` with `Retry-After`. Authentication failures are rejected before the limiter. Limits are process-local and reset on restart.
4. **Tokens expire by default.** Provisioning sets a 30-day expiry unless `--ttl-days` or an explicit expiry is supplied. `expiresAt` is returned by provisioning and `GET /v1/whoami`. Revocation remains immediate.
5. **Audit export is a tenant-scoped read, not a signed ledger.** `/v1/audit/export` returns JSON or NDJSON with optional `from`/`to` bounds and a maximum of 10,000 events. It does not claim tamper evidence.
6. **Metrics and traces are local primitives.** `/v1/metrics` exposes Prometheus text for admins. W3C `traceparent` is validated and propagated; malformed or all-zero contexts are replaced. No trace backend or alerting is included.
7. **Backups use the SQLite online backup API.** The backup CLI verifies integrity and can prune old files. The restore drill copies the backup, opens the restored database, verifies schema and row counts, and removes the temporary copy unless retained.
8. **Event payloads for API event types are strict.** `MissionCreated`, `MissionStateChanged`, `TaskCreated`, and `TaskStateChanged` reject missing, malformed, and undeclared fields. Other event types remain envelope-only until producers exist.

## Consequences

- Retries of successful API writes are safe when callers supply a key.
- The API remains single-process. Idempotency and rate limits are not shared across replicas and are not a substitute for a durable job system.
- A 24-hour replay window and lazy cleanup bound local storage growth but are not configurable yet.
- Token expiry reduces the lifetime of a stolen token but does not replace TLS, MFA, or authentication-failure throttling.
- Audit exports and backups contain sensitive tenant data and require the same access controls as the live database.
- Metrics aggregate across tenants, so the endpoint is restricted to `ADMIN`.
- Task transitions are still not coupled to mission terminal state. That lifecycle decision remains open.

## Alternatives considered

- **Mandatory idempotency keys:** rejected for now because it would break existing clients and complicate reads; optional keys preserve compatibility.
- **Persisted rate-limit buckets:** deferred because SQLite would add write amplification and still not provide multi-node coordination.
- **Signed audit exports:** deferred until key management and a canonical event chain exist.
- **OpenTelemetry SDK:** deferred to avoid adding a large dependency and an unverified exporter; trace-context propagation provides a migration path.
- **Copying the SQLite file:** rejected because WAL-mode copies can be inconsistent; the online backup API is used instead.

## Evidence

- `apps/api/src/idempotency.ts`
- `apps/api/src/rate-limit.ts`
- `apps/api/src/auth.ts`
- `apps/api/src/provisioning.ts`
- `apps/api/src/backup-lib.ts`
- `apps/api/src/metrics.ts`
- `apps/api/src/trace.ts`
- `packages/core/src/retry.ts`
- `packages/core/src/events.ts`
- `tests/integration/api.test.ts`
- `tests/integration/backup.test.ts`
- `tests/unit/retry.test.ts`
- `tests/unit/rate-limit.test.ts`
- `docs/api/API.md`
- `docs/operations/RUNBOOK.md`
