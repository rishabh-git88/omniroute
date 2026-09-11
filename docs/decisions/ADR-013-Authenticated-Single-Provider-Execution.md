# ADR-013: Authenticated single-provider execution

Status: Accepted for the first real execution milestone.

## Context

Frozen provider-neutral context exists, but conversation execution previously
called MockProvider directly and ignored failure events. FastAPI exposed provider
execution without service authentication. These boundaries must work before
additional providers or real comparisons are enabled.

## Decision

NestJS retains ownership of browser authorization, the user-selected routing
decision, model/registry identity, frozen snapshots, reservations, and persistence.
Its execution gateway sends the canonical request and reviewed registry snapshot
to FastAPI `POST /providers/stream`. The TypeScript/Zod envelope and its generated
JSON Schema share acceptance fixtures with Python.

Enable only OpenAI Responses for this milestone. Provider identifiers and prices
come from the registry, never hardcoded defaults. Existing Anthropic/Gemini adapter
contract tests remain, but those providers cannot execute through the service.
Real Compare 3, alternatives, and fallback execution are not enabled. Existing
mock comparisons remain development/test functionality.

Both services use the same server-only `AI_ROUTER_INTERNAL_TOKEN` (at least 32
characters) in the Authorization bearer header. Missing, wrong, or unconfigured
authentication is rejected before execution. Health probes remain public. The
internal URL must be explicitly configured to enable OpenAI execution. Deploy it
on private networking; bearer authentication does not replace transport security.

`AI_EXECUTION_PROVIDER` selects `openai`, `mock`, or `disabled`. Defaults are mock
in development/test and disabled in production. Production rejects mock mode.
OpenAI additionally requires router enablement, a server-only provider key, and
an explicitly enabled reviewed registry entry. No keys or real prices are seeded
by this change.

The router uses asynchronous HTTP without redirects, ambient proxy settings,
provider-side stored conversation state, automatic retries, or background runs.
The full frozen context is supplied for each call. Default router deadline is 90
seconds; Nest's deadline is 95 seconds. Output is limited by the frozen model
budget, requested `max_output_tokens`, a router token ceiling, and independent
262 KiB default text byte ceilings. Oversized frames and malformed or truncated
streams fail explicitly. A completed response requires reported input/output
usage. Exactly one terminal event is consumed/emitted per connected attempt.

Browser Stop aborts Nest's outbound HTTP request. FastAPI's disconnect cancellation
closes the asynchronous provider socket, including when the upstream is blocked.
Closing the browser event subscription alone does not cancel a durable run; the
explicit Stop command does. Transport cancellation cannot guarantee a provider
has stopped billing already accepted work.

Nest persists request correlation, elapsed milliseconds, usage completeness,
normalized failure codes, partial output, and billing disposition in the additive
`model_runs.execution_result` field. Complete responses enter canonical history;
partial failures do not move the active branch head. Reported usage is settled
before publishing the terminal state, including reported usage on failed runs.
Unknown usage after dispatch is never invented as zero: its reservation remains
held with `reconciliation_required`. Confirmed non-dispatch failures release it.

## Verification

Unit and shared-schema tests cover authentication, envelope compatibility,
fragmented SSE, UTF-8, terminal/error normalization, timeout, cancellation,
output limits, and production mock exclusion. Guarded PostgreSQL integration
tests launch actual NestJS and FastAPI HTTP servers and use a loopback OpenAI
wire fixture. They verify streaming, CORS, persistence, billing disposition, and
upstream disconnect. They never use provider accounts or developer database data.

## Consequences and limitations

An external account smoke test still requires credentials and a reviewed enabled
model with real pricing. No live API request is made by the verification suite.
Single-process execution ownership and SSE replay are still in memory. A restart
or a Stop command routed to another API replica requires durable coordination and
recovery before horizontal deployment. Database failure can prevent durable
terminal state; the browser receives `PERSISTENCE_FAILED` instead of success.
A reconciliation worker/operator workflow for unknown usage and interrupted runs
is still required. This milestone does not claim exactly-once external execution
across process crashes.

## Open Questions

- Which reviewed OpenAI model, regional policy, and pricing snapshot should be
  enabled for the first external-account smoke test?
- What evidence and time limit should resolve reservations when provider usage
  is unavailable after cancellation or transport failure?

## Related notes

[[Provider-Layer]] · [[AI-Router]] · [[Model-Registry]] · [[Credits-Billing]] ·
[[ADR-012-Frozen-Canonical-Context]]
