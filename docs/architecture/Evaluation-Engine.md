# Evaluation Engine

#architecture #ai

## Purpose

Measure response quality, routing outcomes, context-switch coherence, and bias without assuming that a user's click is an objective quality label.

## Responsibilities

- Record provider/model shown, tab position, completion, length, latency, selection, regenerate, later switch, and explicit feedback.
- Separate explicit selection from passive viewing.
- Capture task category and context-snapshot metadata without retaining raw sensitive content by default.
- Randomize tab order in controlled experiments.
- Maintain small expert-reviewed task sets before any Auto Pick feature.
- Report provider quality separately from availability and platform reliability.

## Inputs and outputs

Inputs are normalized run telemetry, product events, user feedback, task labels, and controlled evaluation fixtures. Outputs are dashboards, regression gates, reviewed datasets, and evidence for future [[AI-Router]] policy changes.

## Dependencies and data used

[[Observability]], [[PostgreSQL-Schema]], [[Context-Memory]], and versioned [[Model-Registry]] snapshots. Derived metrics may outlive raw content when privacy policy permits.

## Failure behavior

Evaluation collection must never block a user response. Drop or queue noncritical analytics during failure, preserve consent, and surface missing-data bias in reports.

## Security considerations

Minimize raw prompts/responses, honor retention and deletion, pseudonymize identifiers, restrict expert-review datasets, and audit access.

## Scalability considerations

Begin with database-backed product events and offline analysis. Do not add Kafka or an online ML router without evidence and a new ADR.

## Implementation notes

Early evaluation includes branch coherence after switching, fact retention, task success, and tab-position preference bias. Selection data supports recommendations only after controlled validation.

## Related notes

[[Product-Vision]] · [[Testing]] · [[Security]] · [[ADR-003-AI-Router]]

## Open Questions

- What consent and retention policy applies to prompt/response evaluation data?
- Who creates and scores the initial expert-reviewed tasks?
- What evidence threshold permits a recommendation feature or Auto Pick experiment?
