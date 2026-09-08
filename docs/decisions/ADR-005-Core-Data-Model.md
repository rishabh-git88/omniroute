# ADR-005: Core Data Model and Credit Reservation Shape

- Status: Accepted
- Date: 2026-09-07
- Source: `references/architecture-source.txt`, sections 4, 6, 7, and 13

## Context

The architecture source fixes the canonical conversation tables and requires a
transactionally locked wallet projection plus an auditable ledger, but left the
wallet scope, branch foreign keys, and reservation granularity open.

## Decision

- Keep canonical chat content in `turns` and `model_responses`; provider payloads
  are limited to versioned snapshots and metering metadata.
- Scope one `credit_wallets` row to a user for the MVP, matching the documented
  reservation query and current owner-only workspace model.
- Create one `credit_reservations` row per model run. Compare mode therefore has
  independently reconcilable reservations under a shared `request_group_id`.
- Keep `credit_transactions` append-only. A reservation lifecycle row may move
  from `PENDING` to `SETTLED` or `RELEASED`, while every balance movement appends
  a grant, reservation, charge, release, refund, or adjustment ledger entry.
- Denormalize provider, model, and registry snapshot identifiers onto model runs
  and protect their consistency with database constraints/triggers.
- Use pgvector metadata now, with a dimensionless nullable `vector` value and no
  approximate index until the semantic-retrieval workload is measured.

## Consequences

Wallet operations can use a narrow `FOR UPDATE` lock and independently reconcile
partial comparison failures. Moving credits to workspace ownership for team
billing will require a future migration and ADR. Prisma supplies type-safe common
access; explicit SQL owns partial indexes, cross-table invariants, vector support,
and ledger locking.

## Related notes

[[PostgreSQL-Schema]] · [[Database-Diagram]] · [[Credits-Billing]] ·
[[ADR-002-PostgreSQL]]

## Open Questions

- What exact provider-price-to-credit conversion policy applies before live
  billing is enabled?
- When team workspaces ship, are wallets transferred, shared, or supplemented by
  a workspace wallet?
