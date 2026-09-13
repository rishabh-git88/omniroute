# Operational Runbooks

## Redis unavailable

Symptoms: cost-bearing writes return `RATE_LIMIT_UNAVAILABLE`; history and
completed conversations remain readable. Check the Render Key Value private
connection and service health without printing its URL. Restore connectivity;
do not bypass the rate limiter or edit ledger rows. PostgreSQL remains durable.

## Provider or AI Router outage

Symptoms: normalized router/provider failures, circuit cooldowns, or fallback.
Check router readiness and the provider’s configured/registry health. Do not add
credentials to logs or retry malformed/validation failures. Completed runs and
known usage remain durable; interrupted dispatches are handled by reconciliation.

## Stuck execution or credits

Use the guarded `pnpm --filter @omniroute/api credits:reconcile` command with
the operator-provided production database environment and its confirmation flag.
Inspect safe IDs/statuses first. Never mark dispatched unknown-usage work free.

## File, S3, or embedding outage

Files remain failed or unavailable for retrieval rather than becoming READY.
Check private storage/embedding configuration, then use the guarded file-recovery
or retry path. Do not make objects public or rerun parsers against untrusted URLs.

## Deployment rollback

Verify `/v1/health` and `/v1/health/ready`, migration status, Redis reachability,
and reconciliation backlog before and after a rollback. A restart must not retry
a completed provider call; stale nonterminal runs are reconciled from PostgreSQL.
