# Security Policy

## Supported versions

No version has been released. The repository is an uncommitted core and API scaffold and is not deployed.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use the repository's private advisory form:

https://github.com/tanviruchahs2580/Enterprise-AI-Agency-OS/security/advisories/new

Include:

- affected file, revision, and configuration;
- reproduction steps or a proof of concept;
- impact and prerequisites;
- whether the issue affects a deployed system;
- any suggested mitigation.

Do not include real credentials, customer data, or production secrets in the report. If a credential was exposed, revoke it before sharing details.

## Scope

Current code covers `packages/core` primitives and a local `apps/api` foundation with bearer authentication, token expiry and revocation, per-token rate limiting, idempotent mission/task writes, tenant-scoped SQLite persistence, audit export, local metrics/traces, and backup/restore tooling. There is no worker, agent runtime, tool execution, production deployment, or external provider integration in this repository. Reports about missing runtime controls are tracked as unimplemented scope, not as vulnerabilities in deployed functionality.

## Disclosure

There is no bug bounty or formal response SLA. The maintainer will acknowledge a report, assess it, and coordinate disclosure when a fix is available.
