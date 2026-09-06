# PostgreSQL Schema

#database #architecture

## Purpose

PostgreSQL 18 is the primary system of record for identity, workspaces, conversation branches, context provenance, file metadata, provider configuration, usage, and credits. Confirm the stable version before implementation.

## Core entities

| Entity | Key fields | Purpose |
|---|---|---|
| `users` | `id`, `email`, `name`, `status`, `created_at` | account lifecycle |
| `workspaces` | `id`, `owner_id`, `plan`, `retention_policy` | tenant and policy boundary |
| `conversations` | `id`, `workspace_id`, `title`, `active_head_id`, `mode` | chat and active branch pointer |
| `turns` | `id`, `conversation_id`, `parent_response_id`, `user_content`, `created_at` | user input anchored to prior selection |
| `model_runs` | `id`, `turn_id`, `provider`, `model_key`, `status`, `request_group_id` | external request lifecycle |
| `model_responses` | `id`, `run_id`, `content`, `selected_at`, `finish_reason` | persistent candidate |
| `context_snapshots` | `id`, `run_id`, `summary_version`, `source_ids`, `token_estimate` | handoff provenance |
| `files` | `id`, `workspace_id`, `object_key`, `mime`, `size`, `scan_status` | object metadata and access boundary |
| `artifacts` | `id`, `conversation_id`, `type`, `object_key`, `source_run_id` | reusable generated output |
| `usage_events` | `id`, `run_id`, `provider_usage`, `price_snapshot`, `actual_cost` | immutable metering |
| `credit_transactions` | `id`, `user_id`, `request_group_id`, `amount`, `type`, `status` | grants/reserves/charges/releases/refunds |
| `provider_registry` | `provider`, `model_key`, `capabilities`, `pricing_version`, `enabled` | versioned model configuration |

The source also requires a transactionally locked `credit_wallets` projection; its complete columns remain to be designed.

## Relationships and invariants

```mermaid
erDiagram
    USER ||--o{ WORKSPACE : owns
    WORKSPACE ||--o{ CONVERSATION : contains
    CONVERSATION ||--o{ TURN : contains
    MODEL_RESPONSE o|--o{ TURN : parent_of
    TURN ||--o{ MODEL_RUN : creates
    MODEL_RUN ||--o| MODEL_RESPONSE : produces
    MODEL_RUN ||--o| CONTEXT_SNAPSHOT : uses
    MODEL_RUN ||--o{ USAGE_EVENT : meters
    WORKSPACE ||--o{ FILE : owns
    CONVERSATION ||--o{ ARTIFACT : contains
    USER ||--o{ CREDIT_TRANSACTION : receives
```

- One idempotency key per user/logical request group.
- At most one active selected response per turn, enforced transactionally.
- Foreign keys connect runs to turns and responses to runs.
- Required indexes include conversation/time, turn/provider, user/time, and request group.
- JSONB is limited to provider metadata and versioned snapshots, not general relational state.

## Inputs and outputs

Repositories receive validated domain commands and write transactional state. Read models provide canonical data to [[Backend]], [[Context-Memory]], and [[API-Design]].

## Failure behavior

Transactions protect branch movement and credits. Migrations follow expand-migrate-contract. Backups must be restorable; Redis loss must not lose durable business state.

## Security and scalability

Scope every query by workspace, audit sensitive state changes, encrypt in transit/at rest, and implement retention/export/deletion. Add indexes from measured queries; use read replicas, partitioning, or pgvector indexes only when justified.

## Related notes

[[ADR-002-PostgreSQL]] · [[Redis]] · [[Vector-Memory]] · [[Credits-Billing]] · [[CI-CD]]

## Open Questions

- What are the precise branch/head foreign-key shapes and deferrable constraint strategy?
- Is the wallet scoped to user, workspace, or both for future teams?
- Which content uses soft deletion versus hard deletion under retention policy?
