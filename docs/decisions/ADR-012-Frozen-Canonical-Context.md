# ADR-012: Frozen Canonical Conversation Context

Status: Accepted

## Decision

Canonical text messages have strict `role`/`content` fields and travel inside
`CanonicalChatRequest.context`. Zod defines the TypeScript contract and published
JSON Schema; shared positive and negative wire fixtures verify Python parity.
Unknown fields, null optional values, coercible strings/booleans, invalid UUIDs,
and unsafe integers are rejected consistently.

Build context from the persisted turn and its parent-response chain. Each prior
user prompt precedes its selected assistant response. Bound traversal and reject
broken/cyclic branches. Scope memories by both owner and conversation; no current
selection or unrelated branch can silently replace a turn's saved parent.

Before execution, persist the entire canonical bundle and budget policy in
`context_snapshots.payload`, with a version and deterministic content hash. Rows
cannot be updated. Metadata-only legacy rows remain readable history but cannot
supply reproducible alternatives; reject rather than manufacture old input.
The executor reloads and validates the persisted payload before mock execution.

Compare 3 creates three mock runs and fits one context to their smallest input
allowance. Every candidate receives the same context hash. Try Another AI copies
the original frozen bundle, including retrieval outcome and provenance, without
consulting live memory. A smaller model that cannot fit it is rejected before a
new run or reservation. A new turn (including the existing regenerate command)
assembles new context; it does not rewrite a prior turn's snapshot.

Registry context/output limits are mandatory. The current conservative text
policy estimates UTF-8 bytes plus 16 units per message and 32 framing units,
reserves up to 512 output tokens within the model limit, and retains 128 units of
additional safety margin. This is a versioned conservative allowance, not a claim
of exact provider tokenization. Real adapters remain disconnected.

Priority is mandatory workspace instructions and the current prompt, then recent
whole user/assistant pairs, then optional preferences and retrieved excerpts.
Never truncate mandatory content; reject if it cannot fit. Omitted history and
optional sources retain explicit provenance with content hashes. Existing stored
summaries are not injected without a verified relationship to the frozen branch;
this implementation does not generate or refresh summaries.

Retrieval uses deterministic ordering and scoped semantic search, then lexical
search, then a recorded unavailable/empty result. Each query has a local database
statement timeout; retrieval failure does not replace or erase canonical history.

## Consequences

Exact reuse can reject a smaller model rather than quietly changing a comparison.
Conservative budgeting may omit more old history than a reviewed tokenizer would.
Payloads duplicate the actual selected context across runs to keep each run
recoverable; normal authorized retention/deletion can still remove snapshots.
A snapshot supports reconstruction, not automatic recovery of abandoned jobs.

## Related notes

[[Context-Memory]] · [[Provider-Layer]] · [[Model-Registry]] · [[PostgreSQL-Schema]]

## Open Questions

Provider-specific tokenizer policies and summary generation require later review
before live-provider execution. No runtime provider integration is authorized by
this decision.
