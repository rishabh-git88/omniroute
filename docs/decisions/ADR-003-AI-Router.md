# ADR-003: AI Router and Provider Boundary

#decision #ai

- Status: Accepted
- Date: 2026-09-06
- Source: `references/architecture-source.txt`, sections 3.4, 5, and 13.2

## Context

OmniRoute must fan out comparisons, switch providers, check changing capabilities, account for costs, and survive provider/API churn without coupling the conversation domain to provider SDKs. User preference data is promising but biased and insufficient for an early ML router.

## Decision

All model execution passes through a provider orchestrator named the [[AI-Router]], which consumes canonical requests and versioned [[Model-Registry]] data and invokes only [[Provider-Layer]] adapters. V1 keeps provider choice explicit while permitting deterministic capability-aware eligibility/ranking. Any automatic selection must live in this router. Personalized or ML-based Auto Pick is deferred until controlled evaluation evidence exists.

## Consequences

Conversation and UI code remain provider-neutral. Providers can fail independently, and capabilities/pricing can change through versioned configuration. The router becomes a critical policy boundary that requires contract tests, transparent decision metadata, bounded concurrency, and careful terminology so ranking is not mistaken for opaque automatic choice.

## Alternatives considered

- Direct provider calls from business modules: rejected because SDK and request types would leak.
- Lowest-common-denominator provider interface: rejected because typed extensions/capabilities preserve useful differences.
- ML routing at launch: rejected because selection data is biased and no controlled evaluation set exists.

## Revisit when

Expert-reviewed evaluations and controlled selection data show reliable recommendation value. ML-based policy requires a new ADR or superseding revision.

## Related notes

[[AI-Router]] · [[Evaluation-Engine]] · [[Context-Memory]] · [[Credits-Billing]]

## Open Questions

- V1 ranking weights, fallback behavior, and evidence thresholds for recommendations remain undecided.
