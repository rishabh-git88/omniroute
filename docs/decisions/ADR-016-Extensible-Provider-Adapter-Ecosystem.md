# ADR-016: Extensible Provider Adapter Ecosystem

**Status:** Accepted  
**Date:** 2026-09-12

## Context

OmniRoute originally shipped adapter implementations for OpenAI, Anthropic, and
Gemini. Development availability now also requires Gemini, Groq, and OpenRouter,
without coupling conversation, billing, routing, SSE, or persistence to a fixed
set of companies.

## Decision

The canonical provider contract has explicit identities for `openai`,
`anthropic`, `gemini`, `groq`, and `openrouter` (plus test-only `fake`). NestJS
continues to send immutable, provider-neutral execution plans only through
ExecutionGateway and AiRouterClient. FastAPI owns adapter lookup and vendor wire
translation. Groq and OpenRouter share a Chat Completions transport normalizer,
but retain distinct adapter classes and provider identities.

`AI_EXECUTION_PROVIDER=multi` admits any enabled real-provider adapter; it does
not encode a fixed provider trio. Runtime enablement, credentials, provider
health, reviewed Model Registry entries, context/output constraints, routing
mode, and bounded fallback determine admission. Compare 3 remains unimplemented;
when added, it must select eligible registry entries rather than company names.

Registry candidates are immutable reviewed snapshots and import disabled. They
cannot enter routing until internal quality, latency, and task evaluation data is
reviewed and activated through the confirmation-gated importer. Provider pricing
records API list pricing. A developer account quota is not silently converted to
zero provider cost.

## Consequences

OpenAI and Anthropic source support remains intact while production can disable
them. Gemini, Groq, and OpenRouter credentials exist only in the FastAPI runtime.
Adapters normalize terminal completion, usage, request IDs, timeouts,
cancellation, HTTP authentication/rate-limit/upstream failures, malformed
events, and truncated streams before NestJS receives events.

## Related notes

[[ADR-008-Provider-Adapter-Contract]] · [[ADR-014-Multi-Provider-Routing]] ·
[[AI-Router]] · [[Provider-Layer]] · [[Model-Registry]]
