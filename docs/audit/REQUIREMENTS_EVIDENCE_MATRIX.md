# Requirements-to-Evidence Matrix

Scope: local `Enterprise-AI-Agency-OS` core and API foundation. The GitHub target is empty. A `N/A` disposition means the corresponding capability does not exist and therefore cannot be assessed as implemented. It is not a pass.

| requirement_id | audit_area | criterion | applicability | status | evidence_ref | finding_ids | owner | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| REPO-01 | Repository identity | Target URL, branch, commit, and working-tree state recorded | Applicable | FAIL | `docs/audit/ENTERPRISE_ENGINEERING_AUDIT.md` A | F-014 | Repository steward | Remote is empty; local `main` has no commits; all files untracked |
| REPO-02 | Baseline | Locked install, lint, typecheck, tests, build assessed | Applicable | PASS | Audit C; `API_FOUNDATION_VERIFICATION.md` D | F-001, F-002, F-006, F-012 | Engineering lead | `npm ci`, lint, typecheck, 104 tests, build, and smoke pass locally; no committed baseline |
| PROD-01 | Product | Advertised features map to working user journeys | Applicable | FAIL | README; Audit B | F-011 | Product owner | Core contracts and a local API exist; no end-to-end agency product |
| PROD-02 | Product | Loading, empty, error, permission, timeout, offline states | Not applicable | N/A | No UI | - | Product owner | No user-facing surface; API error and permission states are tested |
| ARCH-01 | Architecture | Modular package boundary with explicit exports | Applicable | PASS | `packages/core/package.json`; `src/index.ts`; `npm run build` | F-012 | Architect | Core package builds with declarations |
| ARCH-02 | Architecture | Service, queue, persistence, and provider contracts | Applicable | IN PROGRESS | `apps/api/src/db.ts`; `repository.ts` | - | Architect | Persistence and API service contracts exist; no queue or provider contracts |
| CODE-01 | Code quality | Lint and strict typecheck pass | Applicable | PASS | `npm run lint`; `npm run typecheck` | F-002 | Engineering lead | Both exit 0 |
| CODE-02 | Code quality | Typed failures and JSON serialization that excludes stack/cause | Applicable | PASS | `errors.ts`; `tests/unit/errors.test.ts` | F-005, F-009 | Engineering lead | Status and code preserved; details are caller-controlled |
| CODE-03 | Code quality | No dead scripts or misleading commands | Applicable | PASS | `package.json`; README scripts table | F-011 | Engineering lead | Only runnable scripts remain |
| TEST-01 | Testing | Unit tests for core business rules | Applicable | PASS | `tests/unit/*`; `npm test` | F-001 | Test lead | 78 unit tests pass; 104 total with API integration tests |
| TEST-02 | Testing | Integration tests with persistence and services | Applicable | PASS | `tests/integration/api.test.ts`; `backup.test.ts` | - | Test lead | Persistence, auth, transitions, restart recovery, idempotency, rate limits, expiry, audit export, metrics/traces, schema migration, backup/restore |
| TEST-03 | Testing | E2E and acceptance journeys | Not applicable | N/A | No E2E harness or UI | - | QA lead | Future scope |
| TEST-04 | Testing | Negative tests for invalid transitions, events, and inputs | Applicable | PASS | `tests/unit/state-machine.test.ts`; `events.test.ts`; `ids.test.ts` | F-003, F-004, F-007, F-008 | Test lead | Includes malformed envelopes, strict event payloads, and graph violations |
| TEST-05 | Testing | Security tests for authz, tenancy, injection, tools | Applicable | IN PROGRESS | `tests/integration/api.test.ts` | - | Security lead | Authz, tenant isolation, token expiry, rate limits, idempotency conflicts, and injection-shaped input covered; no tool tests |
| API-01 | API | Authentication, authorization, tenant scoping, object access | Applicable | PASS | `apps/api/src/auth.ts`; `repository.ts`; integration tests | - | Backend lead | Bearer auth, scopes, and tenant-scoped object access are tested |
| API-02 | API | Input/output schemas, status codes, pagination, rate limits | Applicable | PASS | `validation.ts`; `server.ts`; integration tests | - | Backend lead | Zod schemas, status codes, offset pagination, per-token rate limits, and Retry-After |
| API-03 | API | Durable jobs, retries, idempotency, cancellation | Applicable | IN PROGRESS | `idempotency.ts`; `packages/core/src/retry.ts`; integration tests | - | Backend lead | Durable idempotency and retry/backoff helpers exist; no worker, queue, or cancellation |
| DB-01 | Data | Schema, constraints, migrations, tenant isolation | Applicable | PASS | `apps/api/src/db.ts`; integration tests | - | Data lead | Strict tables, FKs, v1-to-v2 migration, tenant predicates |
| DB-02 | Data | Backup, restore, retention, encryption | Applicable | IN PROGRESS | `backup-lib.ts`; `backup.ts`; `restore-drill.ts`; integration tests | - | Data lead | Online backup, integrity verification, retention pruning, and restore drill; no encryption or scheduler |
| AUTH-01 | Identity | Password, session, token, MFA, revocation | Applicable | IN PROGRESS | `apps/api/src/auth.ts`; `provisioning.ts` | - | Security lead | Bearer tokens, 30-day expiry, and revocation; no password, session, or MFA |
| AUTH-02 | Identity | Role/permission matrix and default deny | Applicable | PASS | `apps/api/src/auth.ts`; integration tests | - | Security lead | ADMIN/OPERATOR/VIEWER scopes; missing scope returns 403 |
| SEC-01 | Security | Dependency audit | Applicable | PASS | `npm audit` | F-006 | Security lead | 0 vulnerabilities after upgrade |
| SEC-02 | Security | SAST, secret scan, container, IaC, DAST | Applicable | NOT RUN | No scanners configured | - | Security lead | Manual secret scan only; no automated scanner evidence |
| SEC-03 | Security | No real secrets in source or example config | Applicable | PASS | `.env.example`; `.gitignore`; SECURITY.md | F-010 | Security lead | No credentials in example config; `.env` and databases ignored |
| SEC-04 | Security | Threat model for untrusted events and errors | Applicable | PASS | `docs/architecture/SECURITY_THREAT_MODEL.md` | F-014 | Security lead | Covers core and API assets, boundaries, token/tenant threats, and residual risks |
| SEC-05 | Security | Supply-chain pinning and provenance | Applicable | IN PROGRESS | SHA-pinned actions; lockfile present | F-013 | Release engineer | No SBOM, artifact signing, or provenance evidence |
| UI-01 | Frontend | Routes, responsive behavior, accessibility | Not applicable | N/A | No frontend | - | Design lead | Future scope |
| UI-02 | Frontend | Truthful states and live metrics | Not applicable | N/A | No UI | - | Design lead | Future scope |
| AI-01 | Model gateway | Provider routing, fallback, budgets, output validation | Not applicable | N/A | No model adapter | - | AI lead | Future scope |
| AGENT-01 | Agents | Registry, contracts, permissions, SOPs, tests | Not applicable | N/A | No agents | - | Agent systems lead | Future scope |
| AGENT-02 | Agents | Independent review and no self-approval | Not applicable | N/A | No agent runtime | - | Agent systems lead | Future scope |
| FLOW-01 | Lifecycle | State machines valid, explicit, and tested | Applicable | PASS | `state-machine.ts`; `tests/unit/state-machine.test.ts` | F-003, F-004, F-005 | Architect | Graph invariants enforced at construction |
| FLOW-02 | Lifecycle | Durable transitions, approvals, audit, recovery | Applicable | IN PROGRESS | `apps/api/src/repository.ts`; integration tests | - | Architect | Durable transitions, events, version checks, restart recovery; no approvals; task/mission terminal coupling incomplete |
| ORCH-01 | Orchestration | DAG scheduling, leases, cancellation, recovery | Not applicable | N/A | No orchestrator | - | Backend lead | Future scope |
| TOOLS-01 | Tools/MCP | Registry, allowlists, sandbox, approvals, audit | Not applicable | N/A | No tool runtime | - | Security lead | Future scope |
| MEM-01 | Memory/RAG | Scoped memory, provenance, deletion, injection defenses | Not applicable | N/A | No memory or retrieval | - | Data lead | Future scope |
| POLICY-01 | Governance | Central policy, approvals, kill switch, separation of duties | Not applicable | N/A | No policy engine | - | Governance lead | Future scope |
| EVAL-01 | LLM quality | Evaluation sets, regression thresholds, adversarial tests | Not applicable | N/A | No models | - | AI quality lead | Future scope |
| OBS-01 | Operations | Logs, metrics, traces, health, alerts, runbooks | Applicable | IN PROGRESS | `server.ts`; `metrics.ts`; `trace.ts`; `docs/operations/RUNBOOK.md` | - | SRE | Structured logs, redaction, health/readiness, Prometheus metrics, trace-context propagation, and runbook; no alerting or trace backend |
| PERF-01 | Performance | Measured latency, cost, capacity, budgets | Applicable | NOT RUN | No benchmark or load test | - | SRE | No performance evidence |
| CI-01 | CI/CD | Workflow validates lint, typecheck, tests, build, audit | Applicable | IN PROGRESS | `.github/workflows/ci.yml` | F-013 | Release engineer | Added locally; never executed on GitHub |
| CI-02 | CI/CD | Least-privilege tokens and pinned actions | Applicable | PASS | `.github/workflows/ci.yml` | F-013 | Release engineer | Contents read only; actions SHA-pinned; install scripts disabled |
| DEPLOY-01 | Deployment | Environment separation, health checks, rollback | Applicable | IN PROGRESS | `/healthz`; `/readyz`; runbook | - | Release engineer | Health checks and local runbook; no environments or rollback |
| DOC-01 | Documentation | README matches verified implementation | Applicable | PASS | `README.md` | F-014 | Documentation steward | States core/API scope and limitations |
| DOC-02 | Documentation | API and operations runbooks | Applicable | PASS | `docs/api/API.md`; `docs/operations/RUNBOOK.md` | - | Documentation steward | Contract, idempotency, rate limits, expiry, audit export, metrics, backup/restore, and incident guidance |
| LEGAL-01 | Privacy/responsible AI | Data categories, notices, provider terms, AI disclosures | Not applicable | N/A | No user data or model use | - | Privacy reviewer | Future scope |

## Disposition counts

- PASS: 19
- FAIL: 2
- IN PROGRESS: 10
- NOT RUN: 2
- N/A: 13

`N/A` rows are unimplemented capabilities, not verified controls. `NOT RUN` rows have no execution evidence. The matrix is therefore not a claim of completeness for a production system.
