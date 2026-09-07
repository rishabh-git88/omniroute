# Provider Layer

#architecture #ai

## Purpose

Isolate OpenAI, Anthropic, Gemini, and future provider SDK/API churn behind canonical contracts inside the FastAPI AI Router service without flattening every capability to the lowest common denominator.

## Canonical contract

```ts
interface AIProvider {
  id: ProviderId;
  capabilities(): Promise<CapabilitySnapshot>;
  streamChat(request: CanonicalChatRequest): AsyncIterable<ProviderEvent>;
  cancel(runId: string): Promise<void>;
  estimate(request: CanonicalChatRequest): Promise<UsageEstimate>;
}
```

Normalized events cover run start, content delta, tool call, usage update, completion, and normalized failure. Capability flags and typed extension fields preserve provider-specific features.

## Responsibilities

- [[Provider-Layer#OpenAI adapter|OpenAI adapter]] targets the Responses API.
- [[Provider-Layer#Anthropic adapter|Anthropic adapter]] targets the Messages API and its streaming events.
- [[Provider-Layer#Gemini adapter|Gemini adapter]] targets the Interactions API.
- Translate canonical context/tools to provider formats and provider output/errors/usage back to canonical types.
- Implement cancellation, estimates, request correlation, timeouts, and provider-specific safe retry behavior.
- Expose capability snapshots to [[Model-Registry]] and pass normalized events to [[AI-Router]].

## OpenAI adapter

The adapter owns OpenAI request/event types and provider request IDs; those types do not enter conversation storage or UI contracts.

## Anthropic adapter

The adapter translates Messages streaming and normalized usage while preserving canonical event order.

## Gemini adapter

The adapter translates Interactions requests/events and reports capability differences through typed metadata.

## Inputs and outputs

Input is a `CanonicalChatRequest` plus a versioned model target. Output is `ProviderEvent` values and a terminal normalized usage/error result.

## Dependencies and data used

Provider SDKs/APIs, server-side credentials, [[Model-Registry]] snapshots, cross-language canonical contracts, and [[Observability]] correlation. Adapters do not own canonical history or direct PostgreSQL repositories.

## Failure behavior

Normalize rate limits, invalid requests, timeouts, provider errors, malformed events, and cancellation. Preserve provider request IDs without secrets. A provider fault remains isolated to one model run.

## Security considerations

Use environment-specific server-side keys, rotation, spend limits, redacted logs, and provider-specific retention review. Tool calls remain proposals until [[Security|application validation and approval]].

## Scalability considerations

Contract-test adapters with recorded/fake streams. Version adapters and run scheduled provider smoke tests; rate-limit per provider/model.

## Implementation notes

Future adapters belong below `services/ai-router`; no provider SDK is installed in Phase 1. Recheck recommended API surfaces, SDK versions, model identifiers, quotas, pricing, and retention immediately before adapter implementation and launch.

## Related notes

[[Backend]] · [[Context-Memory]] · [[Testing]] · [[MVP-Scope]]

## Open Questions

- Which exact models and regional endpoints are enabled for the initial registry?
- How are provider-native file uploads cached and deleted across runs?
