# ADR-014: Production multi-provider routing

Status: Accepted for Phase 6 implementation; live account and distributed operation gates remain open.

## Context

The authenticated NestJS → FastAPI execution boundary exists. The previous product
path admitted only OpenAI, routing modes were local frontend preferences, and the
router treated free prices as missing. Anthropic lost its initial input usage;
Gemini did not transmit output limits.

## Decision

Preserve the service boundary and the modular monolith's ownership of durable
state. NestJS authorizes the conversation, freezes canonical text context, and
sends versioned database registry snapshots to authenticated FastAPI routing.
FastAPI classifies the task deterministically and returns an ordered eligible
list. No LLM call is used for classification. NestJS persists the selected mode,
request/decision, original target, and candidates before reserving credits and
executing. Client pricing and client-written routing decisions are never trusted.

### Canonical provider contract

OpenAI Responses, Anthropic Messages, and Gemini `streamGenerateContent` implement
the same generate/stream/cancel/usage/capabilities/health interface. Generate
collects the normalized stream. Gemini uses the documented generateContent
protocol instead of the earlier Interactions payload. Providers receive the full
frozen canonical messages; system instructions are translated explicitly.

Events are `run.started`, `content.delta`, `usage.updated`, `run.completed`, and
`run.failed`. Usage contains nonnegative input/output/total counts and an optional
`usageFinal` flag. Anthropic message-start usage is retained when subsequent
cumulative updates omit input counts; initial usage is not sufficient to settle
an interrupted attempt. Gemini output includes candidate and thinking tokens.
Finish reasons normalize to `stop` or `length`; safety stops are failures and
cannot trigger fallback. Provider response/request IDs remain optional canonical
strings. Raw response objects, keys, and error messages stay inside adapters.

Every connected attempt has a router deadline, Nest deadline, UTF-8 output byte
limit, registry output/context limits, explicit EOF failure, and one terminal
event. Stop closes Nest's outbound socket and cancellation unwinds the provider
HTTP stream. Closing a browser subscription alone does not cancel paid work.

### Registry eligibility and algorithms

Real routing requires reviewed pricing/provenance, immutable registry/pricing
versions, valid text modalities and limits, `taskScores.general`, `qualityScore`,
and `typicalLatencyMs`. Task and quality scores are 0–100; latency is 1–300000 ms.
Other task scores are optional and fall back to general. Seed compatibility is
retained for older records; incomplete records are excluded from real routing.
Models must be enabled, effective, unretired, in an allowed region, and have an
enabled provider. DISABLED rollout is excluded; production admits GENERAL only.
The latest eligible registry version is used once per model. The router repeats
capability/context/price checks and uses its own observed provider health.

Tasks: general, coding, debugging, architecture, reasoning, writing,
summarization, research, long-context, and structured-data; explicit multimodal
requirements retain their capability filter. Keyword classification does not
promise live web research or tool execution. The current canonical execution
contract carries text. Context ≥64000 estimated tokens is long-context; otherwise
structured-data, debugging, architecture, coding, summarization, research,
reasoning, writing keywords are considered in that order.

All modes require sufficient context for conservative UTF-8 estimation + output
cap + 128 safety tokens. The product output cap is 512 tokens. Context is built
once against the largest eligible model budget; smaller incompatible models are
excluded instead of rebuilding different inputs for ranking or fallback.

- **Economy:** sort ascending by exact Decimal estimated USD:
  `(inputPrice × estimatedInputTokens + outputPrice × outputCap) / 1000000`.
  Explicit zero is zero. Missing, malformed, negative, or nonfinite prices are
  excluded. Quality, latency, and preferences cannot displace a cheaper eligible
  automatic candidate. Equal cost ties use model key.
- **Smart:** score `0.40 suitability + 0.25 quality + 0.10 speed + 0.10 health
  + 0.10 affordability + 0.05 contextHeadroom`. Scores are normalized to 0–1.
  Speed is `1/(1+latencyMs/1000)` using observed latency when present, otherwise
  reviewed latency. Health is 1 for observed available, .5 for enabled/unobserved,
  .25 for a supplied degraded test snapshot. Affordability is `1-cost/maxCost`
  among eligible models, or 1 when all are free. Headroom is capped at 1 using
  `contextWindow/(2 × (inputEstimate+outputCap+128))`. Ties use model key.
- **Max:** score `0.60 quality + 0.40 taskSuitability`, with model key ties.
  Higher prices do not reduce its score. Eligibility, region, context, provider
  concurrency limits, and credit reservations still apply.

An explicit model selection is validated against all eligibility checks and
wins over automatic ranking. It has no automatic fallback. Selecting a mode in
the frontend restores Auto selection; the sent command contains `routingMode`.
The response UI shows the actual model/provider and persisted routing mode.

### Observed health and admission

States distinguish disabled, enabled but unobserved, missing credentials,
available, rate limited, timed out, temporarily unhealthy, and unavailable.
Configured credentials alone produce **enabled**, never **available**. Actual
terminal observations update health. Successful observations expire after five
minutes; failures use a default 30-second cooldown before a new real request may
probe the provider. No paid background health probes run. Only enabled/unobserved
or observed available providers are admitted by the live routing endpoint.

Router admission defaults to 16 concurrent attempts per process. A full process
rejects the attempt before provider dispatch. Health and admission counters are
bounded in memory; shared Redis coordination is still required for multiple
workers/replicas. PostgreSQL remains authoritative for all runs and credits.

### Fallback and accounting

Auto mode permits at most two fallback attempts to distinct eligible models from
the persisted decision. Each attempt has a new ModelRun, immutable snapshot with
the same context hash, and its own reserve-before-call credit lifecycle. NestJS
owns this sequence; the legacy router fallback HTTP endpoint remains disabled to
avoid a second path that could execute without per-attempt reservation.

Fallback is allowed before visible content for timeout, temporary provider error,
rate limit, unavailable/disabled/missing-credential provider, truncated stream,
missing terminal usage, or malformed provider protocol. It is forbidden after
content, on user validation, authentication failure, cancellation, safety stops,
output-limit violation, request-admission limits, unknown errors, or explicit
model selection. Runtime registry enablement/region constraints are rechecked.
Budget checks and credit reservation still apply to every replacement.

Each failed run records its code and replacement target; the final run records
original and final provider/model, ordered prior failures, fallback count, mode,
latency, normalized usage, and registry-computed estimate/actual usage cost.
These are estimates of provider charges from the reviewed price snapshot, not an
external invoice. Reported final usage settles the attempt; unknown/interim usage
retains its reservation for reconciliation. Successful fallback completes the
group while failed attempts remain auditable. A transition event keeps SSE open
and updates the browser's cancel target before the replacement starts.

## Configuration and verification

`AI_EXECUTION_PROVIDER=multi` admits OpenAI, Anthropic, and Gemini; individual
provider values remain supported. Each FastAPI adapter still requires its own
enablement flag and server-side key. Production rejects MockProvider. The shared
internal token is mandatory. Optional `AI_ROUTING_REGION` enforces regional
entries. No real models, prices, keys, or enablement are invented by this change.

Deterministic tests cover provider wire formats, usage, limits, errors,
timeouts/cancellation, all routing modes, eligibility, fallback policy, shared
Zod/JSON Schema/Pydantic fixtures, and composer commands. Guarded PostgreSQL tests
use real NestJS/FastAPI HTTP services and local provider protocol fixtures.
Normal CI performs no paid calls. Live account smoke tests require explicitly
configured credentials and reviewed enabled models; synthetic evidence does not
establish live account access or provider service availability.

Protocol references: [OpenAI streaming](https://developers.openai.com/api/docs/guides/streaming-responses),
[Anthropic streaming](https://platform.claude.com/docs/en/build-with-claude/streaming),
and [Gemini generateContent](https://ai.google.dev/api/generate-content).

## Open Questions

- Which approved models, scores, prices, regions, and live test accounts will be
  enabled for staging?
- What reconciliation evidence resolves unknown provider usage after interruption?
- Which shared health/admission and execution recovery mechanism will support
  multiple API/router workers before horizontal deployment?

Compare 3 still needs independent concurrent run UI, replay/reconnect correctness,
selection/continuation acceptance, and per-run cancellation/accounting under
failures. Real alternatives and Compare 3 remain disabled.

## Related notes

[[AI-Router]] · [[Provider-Layer]] · [[Model-Registry]] · [[Credits-Billing]] ·
[[ADR-012-Frozen-Canonical-Context]] · [[ADR-013-Authenticated-Single-Provider-Execution]]
