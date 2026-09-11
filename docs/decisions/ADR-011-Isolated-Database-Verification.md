# ADR-011: Isolated Database Verification and Reviewed Registry Seeds

Date: 2026-09-10
Status: Accepted

## Context

The audit found a development database missing the workspace-memory migration,
legacy `google` provider metadata, and integration suites capable of truncating
an existing database. Release Milestone 2 authorizes database alignment and CI
repair; production provisioning and provider execution remain outside this work.

## Decision

Integration tests use an independent Compose project with tmpfs PostgreSQL,
synthetic credentials, a restricted database owner, explicit database names, and
a database comment identifying the disposable environment. CI bootstraps the same
identity. No integration container mounts the developer's PostgreSQL volume.

Before connecting, validate both `DATABASE_TEST_URL` and any existing
`DATABASE_URL`. Reject development, production, unknown database names, remote
hosts, unexpected roles, URL query overrides, and non-test execution modes.
Before writes, verify the actual server database name, role privileges, and
disposable marker. Missing configuration fails rather than skipping tests.
Direct integration-suite execution uses the same server identity guard.

The runner validates checksums of applied migrations, deploys unchanged migration
files, checks migration status and Prisma drift, and verifies memory-specific
catalog objects. A separate fresh database rehearses the core-to-memory upgrade
with retained synthetic data. It refuses to reset an existing upgrade database.
The main runner serializes its execution with a PostgreSQL advisory lock.

Development repair uses a verified local target and a restricted backup before
applying pending migrations. Never reset or rewrite applied migration history.
Legacy provider metadata is reconciled transactionally, preserving referenced
IDs; two populated legacy/canonical records require explicit reconciliation.

Real-provider seed metadata defaults to disabled with no model prices. Optional
configuration must specify exact decimal prices, provenance, review time,
capabilities, stable identities, and versions. Existing registry snapshots are
immutable through this seed path. New snapshots remain disabled. This is not an
execution enablement mechanism or a pricing-freshness policy.

## Consequences

Previously accepted arbitrary test URLs and missing-URL skips now fail. The old
`omniroute_test` database is deliberately unsupported. Local seeds are restricted
to the recognized development target, and production seeding needs a separately
reviewed operational path. These guards protect against accidental targeting;
they do not authenticate a malicious database administrator.

## Related notes

[[Database-Verification]] · [[Testing]] · [[PostgreSQL-Schema]] · [[Model-Registry]]
· [[CI-CD]] · [[CURRENT-STATE]]

## Open Questions

Who approves actual release model/pricing snapshots and their freshness policy?
Production migration/registry rollout ownership remains a later release gate.
