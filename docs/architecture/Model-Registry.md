# Model Registry

#architecture #ai

## Purpose

Provide versioned configuration for provider/model identity, capabilities, pricing, availability, and safe rollout. It prevents model knowledge from becoming scattered hardcoded logic.

## Responsibilities

- Map stable internal `model_key` values to provider model identifiers.
- Store capability snapshots for text, images, files, tools, search, context window, and output limits.
- Store enablement, rollout state, region constraints, pricing version, and update timestamps.
- Supply [[AI-Router]] eligibility/ranking and [[Credits-Billing]] estimation inputs.
- Support audit of the configuration used for each run.

## Inputs and outputs

Inputs are reviewed provider documentation, adapter capability discovery, pricing revisions, smoke-test health, and administrative rollout choices. Outputs are immutable/versioned snapshots consumed by routing, UI, policy, and accounting.

## Dependencies

[[Provider-Layer]], [[PostgreSQL-Schema]], [[Evaluation-Engine]], and deployment configuration.

## Data used

The `provider_registry` relation includes provider, model key, capabilities, pricing version, and enabled state. JSONB is appropriate for versioned capability metadata, while stable identifiers and rollout fields remain relational.

## Failure behavior

Fail closed when capability or pricing information required for safe execution is missing. Existing runs retain their recorded snapshot; configuration changes apply only to later runs.

## Security considerations

Registry administration is privileged and audited. Never store provider secrets or user content in capability records. Prevent unreviewed enablement from widening data residency or tool permissions.

## Scalability considerations

Cache immutable snapshots safely in [[Redis]], invalidate by version, and avoid live provider discovery on the request path.

## Implementation notes

Review provider/API migrations monthly and use scheduled smoke tests. The UI may display capability and estimate summaries but must not recreate registry rules client-side.

Provider execution receives the selected entry as an immutable snapshot:
provider key, provider model identifier, registry version, capabilities, and
pricing version. This gives the adapter the information it needs to translate a
request while leaving pricing and capability policy in registry administration.

## Related notes

[[AI-Router]] · [[Provider-Layer]] · [[Frontend]] · [[Observability]]

## Open Questions

- Who approves registry changes, and is an admin UI part of weeks 2–3 or configuration-only initially?
- What freshness threshold disables a model when capability, pricing, or smoke-test data is stale?
