# ADR-008: Provider-Neutral Adapter Contract

#decision #architecture

## Status

Accepted for MVP provider development.

## Decision

The FastAPI AI Router owns a single provider-neutral adapter contract with
`generate`, `stream`, `capabilities`, `usage`, `health`, and `cancel` methods.
OpenAI Responses, Anthropic Messages, and Gemini Interactions translations and
credentials are confined to `services/ai-router/app/providers`. NestJS,
conversation persistence, and the web client consume only canonical requests,
normalized events, and usage.

Every execution plan carries an immutable Model Registry snapshot containing
the reviewed provider model identifier, registry version, capabilities, and
pricing version. The adapter validates its provider against that snapshot and
does not embed model price or capability business rules. Credits remain owned
by NestJS and settle only from normalized terminal usage.

## Consequences

- Individual providers are off by default and require both an enable flag and
  a server-side environment credential.
- Contract tests use injected fake transports; no key or external call is
  required for CI.
- Local cancellation stops the active adapter stream. Provider-native
  asynchronous cancellation can be added within an adapter without altering
  callers.
- Live registry administration remains a reviewed, privileged operation.

## Related notes

[[Provider-Layer]] · [[AI-Router]] · [[Model-Registry]] · [[Credits-Billing]]
