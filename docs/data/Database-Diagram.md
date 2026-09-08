# Database Diagram

#database #architecture

This diagram describes the Phase 2 PostgreSQL schema. `turns.user_content` and
`model_responses.content` are the provider-neutral canonical message records;
provider request and response formats do not enter the conversation tables.
The MVP conversation flow creates the request group, routing decision, model
run, and per-run context snapshot before streaming begins; the diagram therefore
also captures the persisted model-selection and routing metadata.

```mermaid
erDiagram
    USERS ||--o{ ACCOUNTS : authenticates_with
    USERS ||--o{ SESSIONS : signs_in_with
    USERS ||--o{ WORKSPACES : owns
    USERS ||--o{ SUBSCRIPTIONS : purchases
    USERS ||--|| CREDIT_WALLETS : holds

    WORKSPACES ||--o{ ENTITLEMENTS : grants
    SUBSCRIPTIONS o|--o{ ENTITLEMENTS : supplies
    WORKSPACES ||--o{ CONVERSATIONS : contains
    WORKSPACES ||--o{ FILES : owns
    WORKSPACES ||--o{ MEMORIES : scopes
    WORKSPACES ||--o{ EMBEDDINGS : isolates

    CONVERSATIONS ||--o{ REQUEST_GROUPS : receives
    REQUEST_GROUPS ||--|| TURNS : creates
    TURNS o|--o{ TURNS : continues_via_selected_response
    REQUEST_GROUPS ||--o| ROUTING_DECISIONS : records
    ROUTING_DECISIONS ||--o{ ROUTING_DECISION_MODELS : considers
    REQUEST_GROUPS ||--o{ MODEL_RUNS : fans_out
    TURNS ||--o{ MODEL_RUNS : produces
    MODEL_RUNS ||--o| MODEL_RESPONSES : returns
    MODEL_RESPONSES o|--o| CONVERSATIONS : active_head
    MODEL_RUNS ||--o| CONTEXT_SNAPSHOTS : uses
    MODEL_RUNS ||--o{ USAGE_EVENTS : meters

    PROVIDERS ||--o{ MODELS : offers
    PROVIDERS ||--o{ PROVIDER_REGISTRY : versions
    MODELS ||--o{ PROVIDER_REGISTRY : snapshots
    PROVIDER_REGISTRY ||--o{ MODEL_RUNS : configures
    PROVIDER_REGISTRY ||--o{ ROUTING_DECISION_MODELS : identifies

    TURNS ||--o{ TURN_FILES : attaches
    FILES ||--o{ TURN_FILES : attached_to
    FILES ||--o{ FILE_CHUNKS : extracts
    CONVERSATIONS ||--o{ ARTIFACTS : contains
    MODEL_RUNS o|--o{ ARTIFACTS : originates
    MEMORIES ||--o{ MEMORY_SOURCES : derives_from
    FILE_CHUNKS o|--o{ EMBEDDINGS : embeds
    MEMORIES o|--o{ EMBEDDINGS : embeds

    CREDIT_WALLETS ||--o{ CREDIT_RESERVATIONS : locks
    REQUEST_GROUPS ||--o{ CREDIT_RESERVATIONS : budgets
    MODEL_RUNS ||--o| CREDIT_RESERVATIONS : reserves
    CREDIT_WALLETS ||--o{ CREDIT_TRANSACTIONS : projects
    CREDIT_RESERVATIONS o|--o{ CREDIT_TRANSACTIONS : reconciles

    USERS ||--o{ FEEDBACK : authors
    CONVERSATIONS ||--o{ FEEDBACK : receives
    MODEL_RESPONSES o|--o{ FEEDBACK : rates
    WORKSPACES ||--o{ AUDIT_EVENTS : audits
```

## Accounting lifecycle

```mermaid
stateDiagram-v2
    [*] --> PENDING: reserve under wallet row lock
    PENDING --> SETTLED: charge actual and release remainder
    PENDING --> RELEASED: no billable usage or cancellation policy
    SETTLED --> [*]
    RELEASED --> [*]
```

Every state transition updates the wallet projection and appends a
`credit_transactions` entry in one serializable transaction. Ledger entries
cannot be updated or deleted.

## Related notes

[[PostgreSQL-Schema]] · [[Credits-Billing]] · [[Vector-Memory]] ·
[[ADR-005-Core-Data-Model]]
