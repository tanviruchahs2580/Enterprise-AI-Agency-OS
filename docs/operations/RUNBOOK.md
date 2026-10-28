# Local API Runbook

Scope: local, single-node operation of `apps/api`. This is not a production deployment procedure.

## Prerequisites

- Node.js 24 LTS or 26 or newer.
- npm 10 or newer.
- A local filesystem directory writable by the API process.

## Build and verify

```bash
npm ci --ignore-scripts
npm run verify
```

`npm run verify` runs lint, strict typecheck, 104 tests, build, and the core smoke test.

## Provision a tenant and token

```bash
npm run provision --workspace @agency/api -- \
  --db .data/agency.db \
  --tenant "Local" \
  --role ADMIN \
  --token-name local-admin \
  --ttl-days 30
```

The command prints a JSON object containing `tenant.id`, `token.id`, `token.expiresAt`, and the plaintext `token.value`. Store the token in a secret manager. The API stores only its SHA-256 hash; the plaintext value cannot be recovered. `--ttl-days` defaults to 30 and accepts 1-3650.

## Start the API

```bash
DATABASE_PATH=.data/agency.db HOST=127.0.0.1 PORT=3000 npm run start:api
```

PowerShell:

```powershell
$env:DATABASE_PATH = ".data/agency.db"
$env:HOST = "127.0.0.1"
$env:PORT = "3000"
npm run start:api
```

Environment variables:

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test`, or `production` |
| `HOST` | `127.0.0.1` | Binding to a non-loopback address requires TLS and network controls |
| `PORT` | `3000` | 1-65535 |
| `DATABASE_PATH` | `.data/agency.db` | SQLite file path |
| `LOG_LEVEL` | `info` | `fatal` through `trace`, or `silent` |
| `RATE_LIMIT_MAX` | `120` | Authenticated requests per token per window, 1-100000 |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window in milliseconds, 1000-3600000 |

The database directory is created if missing. Migrations run automatically at startup. The schema version is stored in SQLite `user_version`; an older binary refuses to open a newer schema. Schema v2 adds token expiry and idempotency records.

## Health checks

```bash
curl -fsS http://127.0.0.1:3000/healthz
curl -fsS http://127.0.0.1:3000/readyz
```

`/healthz` proves the process is accepting requests. `/readyz` also checks the SQLite connection. Neither endpoint is a substitute for dependency checks or alerting.

## Metrics and traces

```bash
curl -fsS http://127.0.0.1:3000/v1/metrics \
  -H "Authorization: Bearer $TOKEN"
```

`/v1/metrics` requires an `ADMIN` token and returns Prometheus text exposition. It includes request totals by method/route/status, duration histogram buckets, in-flight requests, and uptime. Metrics are process-local and aggregate across tenants.

The API accepts a W3C `traceparent` header and returns `traceparent`, `x-trace-id`, and `x-request-id`. A valid inbound trace id is preserved; otherwise a trace id is derived from the server request id. There is no OpenTelemetry exporter, trace backend, or alerting integration yet.

## Logs

The API logs structured JSON to stdout. `Authorization` headers are redacted. Request ids are returned in `x-request-id` and trace ids in `x-trace-id`. Do not log tokens, request bodies, or event payloads in downstream systems.

## Idempotency

Send `Idempotency-Key` on mission/task creates and transitions to make retries safe:

```bash
curl -sS -X POST http://127.0.0.1:3000/v1/missions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: mission-create-001" \
  -H "Content-Type: application/json" \
  -d '{"title":"Retry-safe mission"}'
```

- Keys are scoped by tenant, token, operation, and canonical request body hash.
- Replays within 24 hours return the stored response with `idempotency-replayed: true`.
- Reusing a key with a different body returns `409 CONFLICT`.
- Records are stored in SQLite and survive process restarts.
- The replay window is not configurable yet.

## Rate limiting

The API limits each authenticated token. Responses include `x-ratelimit-limit`, `x-ratelimit-remaining`, and `x-ratelimit-reset`. Exhausted budgets return `429 RATE_LIMITED` with `Retry-After` seconds. Limits are per process; restarting the API resets them. Authentication failures are not counted.

## Token rotation, expiry, and revocation

1. Provision a new token for the tenant with the required role and TTL.
2. Deploy or configure the client with the new token.
3. Revoke the old token:

```bash
npm run revoke --workspace @agency/api -- \
  --db .data/agency.db \
  --tenant-id <tenant-id> \
  --token-id <old-token-id>
```

Revocation is immediate for subsequent requests. Expired tokens are rejected automatically. There is no token-listing, renewal, or self-service API. Track `expiresAt` from provisioning or `GET /v1/whoami` and rotate before expiry.

## Audit export

```bash
curl -fsS "http://127.0.0.1:3000/v1/audit/export?format=ndjson" \
  -H "Authorization: Bearer $TOKEN" \
  -o audit-export.jsonl
```

Query parameters:

- `from`, `to`: optional ISO-8601 UTC timestamps with milliseconds.
- `format`: `ndjson` (default) or `json`.
- `limit`: 1-10000, default 1000.

Exports are tenant-scoped and point-in-time. They are not signed, hash-chained, or tamper-evident. Treat exports as sensitive data and apply the same access controls as the database.

## Backup

Build the CLIs first, then create a verified online backup:

```bash
npm run build
npm run backup -- --db .data/agency.db --out backups --keep 14
```

The command uses the SQLite online backup API, runs `PRAGMA integrity_check` on the result, and prints a JSON summary. `--keep` prunes older `agency-*.db` files in the output directory. Backups contain tenant data, token hashes, and event history. Store them with the same access controls as the live database. Encryption at rest is not implemented.

## Restore drill

Verify a backup by restoring it into a temporary database and comparing row counts:

```bash
npm run restore:drill -- --backup backups/agency-<timestamp>.db --expect-tenant "Local"
```

The drill copies the backup, opens the restored database (running migrations if needed), verifies `PRAGMA integrity_check`, schema version, and tenant/token/mission/task/event counts, then removes the temporary copy. Use `--to <path> --keep` to retain a restored database for inspection. Run this drill after every schema change and before relying on a backup.

## Restore

1. Stop the API process.
2. Preserve the current database and its `-wal` and `-shm` files for investigation.
3. Create and verify a fresh backup of the current database.
4. Run the restore drill against the chosen backup.
5. Replace the database with the verified backup.
6. Remove stale `-wal` and `-shm` files from the restored path.
7. Start the API and check `/readyz`.
8. Verify a sample mission and event through the API.

A restore is a destructive local operation. Confirm the target path and take a second backup before replacing data.

## Incident response

- **Suspected token exposure:** revoke the token, issue a replacement, and inspect event history for unexpected actors. The `actor_id` on events is the token id.
- **Suspected tenant leak:** stop the API, preserve the database, and review queries and access logs. Cross-tenant reads require both a valid token and a matching `tenant_id` predicate.
- **Rate-limit exhaustion:** identify the token from access logs, confirm the client retry behavior, and raise `RATE_LIMIT_MAX` only after checking capacity. The limiter is in-memory and resets on restart.
- **Corrupt database:** stop the API, run `PRAGMA integrity_check` on a copy, restore the last verified backup, and record the data-loss window.
- **Unhandled 500s:** capture the `x-request-id`, `x-trace-id`, structured log entry, and database state. Do not paste tokens or payloads into public issues.

## Known operational gaps

- Single process, single SQLite writer; no horizontal scaling or lease coordination.
- No TLS termination, WAF, distributed rate limiting, or IP allowlist in the API.
- No OpenTelemetry export, trace backend, alerting, log aggregation, or retention automation.
- No scheduled backup job, off-host replication, backup encryption, or tested disaster-recovery objective.
- No deployment pipeline, rollback automation, or environment separation. CI runs on push and pull requests, and branch protection requires the `verify` check.
- No independent security review of the API foundation.
