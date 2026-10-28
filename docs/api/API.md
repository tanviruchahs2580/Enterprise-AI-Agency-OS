# API Contract

Status: local foundation, not production-ready. The API is implemented in `apps/api` with Fastify, Zod request validation, and local SQLite persistence.

## Base URL and defaults

- Default bind: `127.0.0.1:3000`
- Default database: `.data/agency.db`
- JSON request limit: 64 KiB
- Request timeout: 15 seconds
- Default rate limit: 120 authenticated requests per token per 60 seconds
- Responses include a server-generated `x-request-id`, `x-trace-id`, `traceparent`, and `Cache-Control: no-store`. Client-supplied request ids are ignored.

## Authentication

Every `/v1` request requires a bearer token:

```http
Authorization: Bearer eaa_<43 base64url characters>
```

Tokens are random 256-bit values. The database stores only a SHA-256 hash. Provision a tenant and token once:

```bash
npm run provision --workspace @agency/api -- \
  --db .data/agency.db \
  --tenant "Local" \
  --role ADMIN \
  --token-name local-admin \
  --ttl-days 30
```

`--ttl-days` is optional and defaults to 30 days. The accepted range is 1-3650. The issued token's `expiresAt` is returned by the CLI and by `GET /v1/whoami`. Expired tokens return `401 UNAUTHENTICATED`.

The plaintext token is printed once. Store it in a secret manager. Revoke it with:

```bash
npm run revoke --workspace @agency/api -- \
  --db .data/agency.db \
  --tenant-id <tenant-id> \
  --token-id <token-id>
```

### Roles and scopes

| Role | Scopes |
| --- | --- |
| `ADMIN` | `missions:read`, `missions:write`, `tasks:read`, `tasks:write`, `events:read` |
| `OPERATOR` | `missions:read`, `missions:write`, `tasks:read`, `tasks:write`, `events:read` |
| `VIEWER` | `missions:read`, `tasks:read`, `events:read` |

Scopes are default-deny. A missing scope returns `403 FORBIDDEN`. Metrics require the `ADMIN` role in addition to `events:read`.

## Tenant isolation

The tenant is derived only from the authenticated token. Tenant ids are never accepted from request bodies or query strings. Every mission, task, event, idempotency record, and count query is filtered by the authenticated tenant. Cross-tenant object access returns `404 NOT_FOUND` to avoid confirming object existence.

## Request and response conventions

- JSON field names use camelCase.
- Mission and task versions start at `0`.
- Transitions require the current `expectedVersion`.
- A successful transition increments the version by one.
- Pagination uses `limit` (1-100, default 20) and `offset` (0-100000, default 0).

### Idempotency

`POST` create and transition routes accept an optional `Idempotency-Key` header:

```http
Idempotency-Key: mission-create-2026-10-27-001
```

- Keys must be 1-128 characters using letters, digits, dot, underscore, colon, or hyphen.
- Records are scoped by tenant, token, operation, and a canonical hash of the request body.
- A replay within 24 hours returns the stored status and body with `Idempotency-Key` semantics preserved and `idempotency-replayed: true`.
- Reusing a key with a different body or operation returns `409 CONFLICT`.
- Expired records are deleted lazily when a key is used.
- Only successful `2xx` responses are stored. Failed attempts can be retried with the same key.
- Idempotency records are not a substitute for the required `expectedVersion`; transitions still need the version that produced the first successful result.

### Rate limiting

Each authenticated token has an in-memory fixed-window budget:

```http
x-ratelimit-limit: 120
x-ratelimit-remaining: 119
x-ratelimit-reset: 1790000000
```

When the budget is exhausted the API returns `429 RATE_LIMITED` with a `Retry-After` header in seconds. Authentication failures are rejected before the limiter. Limits are per process and are not shared across replicas.

### Trace context

The API accepts an optional W3C `traceparent` header. A valid inbound trace id is preserved; otherwise the server derives a trace id from its request id. Responses include `x-trace-id` and a server-generated `traceparent` span context. Logs and errors carry `x-request-id` for correlation.

### Error envelope

```json
{
  "error": {
    "name": "AppError",
    "code": "CONFLICT",
    "message": "Mission version conflict",
    "status": 409,
    "retryable": false,
    "details": {
      "expectedVersion": 0,
      "actualVersion": 1
    },
    "requestId": "req-1"
  }
}
```

Validation failures include an `issues` array under `details` with `path` and `message`.

## Endpoints

### Health

| Method | Path | Auth | Response |
| --- | --- | --- | --- |
| `GET` | `/healthz` | none | `200 {"status":"ok"}` |
| `GET` | `/readyz` | none | `200 {"status":"ready"}` or `503 {"status":"unavailable"}` |

### Identity

| Method | Path | Scope | Response |
| --- | --- | --- | --- |
| `GET` | `/v1/whoami` | authenticated | Tenant, token id, role, scopes, and `expiresAt` |

### Missions

| Method | Path | Scope | Body / query |
| --- | --- | --- | --- |
| `POST` | `/v1/missions` | `missions:write` | `{ "title": string, "description"?: string }` |
| `GET` | `/v1/missions` | `missions:read` | `limit`, `offset` |
| `GET` | `/v1/missions/:missionId` | `missions:read` | none |
| `POST` | `/v1/missions/:missionId/transitions` | `missions:write` | `{ "to": MissionState, "expectedVersion": number, "reason"?: string }` |

`POST /v1/missions` returns `201`:

```json
{
  "mission": {
    "id": "uuid",
    "code": "MSN-0001",
    "title": "Example",
    "description": "",
    "state": "DRAFT",
    "version": 0,
    "createdBy": "token-id",
    "createdAt": "2026-10-23T00:00:00.000Z",
    "updatedAt": "2026-10-23T00:00:00.000Z"
  },
  "eventId": "uuid"
}
```

Mission codes are allocated per tenant as `MSN-0001`, `MSN-0002`, and so on. Allowed states and transitions are defined in `packages/core/src/state-machine.ts` and documented in `docs/architecture/WORKFLOW_STATE_MACHINE.md`.

### Tasks

| Method | Path | Scope | Body / query |
| --- | --- | --- | --- |
| `POST` | `/v1/missions/:missionId/tasks` | `tasks:write` | `{ "title": string, "description"?: string }` |
| `GET` | `/v1/missions/:missionId/tasks` | `tasks:read` | `limit`, `offset` |
| `GET` | `/v1/tasks/:taskId` | `tasks:read` | none |
| `POST` | `/v1/tasks/:taskId/transitions` | `tasks:write` | `{ "to": TaskState, "expectedVersion": number, "reason"?: string }` |

Task codes are allocated per tenant as `TSK-0001`, `TSK-0002`, and so on. Creating a task under a mission in a terminal state returns `409 CONFLICT`.

### Events

| Method | Path | Scope | Query |
| --- | --- | --- | --- |
| `GET` | `/v1/events` | `events:read` | `aggregateType` (`MISSION` or `TASK`), `aggregateId` (UUID), `limit`, `offset` |
| `GET` | `/v1/audit/export` | `events:read` | `from`, `to` (ISO-8601 UTC), `format` (`json` or `ndjson`, default `ndjson`), `limit` (1-10000, default 1000) |

Events are returned in occurrence order, with same-millisecond events ordered by insertion sequence. The four API event types have strict payload schemas validated at creation and when read back:

| Event | Required payload fields |
| --- | --- |
| `MissionCreated` | `mission_id`, `code`, `title`, `state` |
| `MissionStateChanged` | `mission_id`, `from`, `to`, optional `reason` |
| `TaskCreated` | `task_id`, `mission_id`, `code`, `title`, `state` |
| `TaskStateChanged` | `task_id`, `mission_id`, `from`, `to`, optional `reason` |

Undeclared payload fields are rejected for these types. Other declared event types retain envelope-only validation until their producers are implemented.

Audit export is tenant-scoped and returns `Content-Disposition: attachment`. NDJSON returns one JSON event per line. JSON returns `{ tenantId, exportedAt, count, events }`. The export is a point-in-time read and does not provide a signed or tamper-evident chain.

### Metrics

| Method | Path | Scope | Response |
| --- | --- | --- | --- |
| `GET` | `/v1/metrics` | `events:read` and `ADMIN` role | Prometheus text exposition |

Metrics include request totals by method, route, and status, request-duration histogram buckets, in-flight requests, and process uptime. Metrics are process-local and aggregate across tenants; restrict access accordingly. There is no OpenTelemetry exporter, distributed tracing backend, or alerting integration.

## Status codes

| Status | Meaning |
| --- | --- |
| `200` | Read or transition succeeded |
| `201` | Mission or task created |
| `400` | Invalid body, query, parameter, or JSON |
| `401` | Missing, malformed, unknown, expired, or revoked token |
| `403` | Missing scope or insufficient role |
| `404` | Object or route not found |
| `409` | Stale version, invalid transition, idempotency conflict, or terminal-mission task creation |
| `413` | Request body larger than 64 KiB |
| `429` | Token rate limit exceeded; inspect `Retry-After` |
| `500` | Unhandled server error |

## Example

```bash
TOKEN="<token from provisioning>"
KEY="mission-create-$(date +%s)"

MISSION=$(curl -sS -X POST http://127.0.0.1:3000/v1/missions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"title":"Build the API"}')

MISSION_ID=$(node -e "console.log(JSON.parse(process.argv[1]).mission.id)" "$MISSION")

curl -sS -X POST "http://127.0.0.1:3000/v1/missions/$MISSION_ID/transitions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $KEY-transition" \
  -H "Content-Type: application/json" \
  -d '{"to":"DISCOVERY","expectedVersion":0}'

curl -sS "http://127.0.0.1:3000/v1/audit/export?format=ndjson" \
  -H "Authorization: Bearer $TOKEN"
```

## Explicit limitations

- No ETags, CORS, cursor pagination, or OpenAPI document.
- No password, session, MFA, OIDC, or token-management API. Tokens expire and can be revoked, but there is no listing, rotation, or self-service endpoint.
- Idempotency records are durable in the local SQLite database but are not shared across replicas. Rate-limit state is process-local and resets on restart.
- SQLite is a single-node local adapter with no encryption at rest, replication, or high availability. Backup automation and restore drills exist, but no scheduler or off-host retention is implemented.
- No event producer authentication, event signatures, consumer delivery guarantee, or tamper-evident audit chain. Producer authentication is currently implicit: events are written only by the authenticated API process, and the actor is the authenticated token id.
- No approval, budget, agent, tool, or provider endpoints.
- No OpenTelemetry export, distributed trace storage, alerting, or log aggregation.
