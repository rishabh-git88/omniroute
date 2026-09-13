# Observability

#architecture #devops

## Purpose

Make each response timely, complete, attributable, economically reconciled, and diagnosable across the platform and external providers.

## Signals

| Area | Measures |
|---|---|
| user experience | time to first token/completion, comparison completion, switch time, reconnect success |
| provider | success, timeout, 429, tokens, latency by model/region |
| product | selection rate/share, switches, branch reactivation |
| economics | provider cost, reserved vs reconciled, margin by mode, free-credit burn |
| context | token size, compression, retrieval hits, switch-coherence feedback |
| system | API errors, queue depth, database latency, Redis health, object failures |

## Trace model

Correlate user turn, request group, model run, provider request, context snapshot, usage event, and ledger entry. Use OpenTelemetry, structured logs, metrics, and error tracking; never put secrets or raw content in routine telemetry.

## MVP implementation

The NestJS API assigns or accepts a validated `X-Request-Id`, returns it on
every response, and emits Fastify/Pino JSON logs with cookie and authorization
headers redacted. It creates basic HTTP spans through the OpenTelemetry Node
SDK before application modules load; standard `OTEL_*` exporter settings select
the collector, so no telemetry vendor is coupled to domain code.

The `omniroute.api` meter records `omniroute.provider.latency`,
`omniroute.provider.errors`, `omniroute.routing.decisions`, and credit
reservation, settlement, and release counters. Attributes are restricted to
provider, versioned model key, routing strategy, outcome, and bounded reason;
they deliberately exclude users, request IDs, prompts, responses, and secrets.
Telemetry export is best effort and does not participate in business
transactions.

## Early service objectives

- Platform API availability excluding providers: 99.9% monthly.
- SSE reconnect recovery: above 99% within the retained event window.
- Credit reconciliation: 100% of terminal runs.
- Context preparation: p95 under two seconds before provider time.
- Provider completion: measured per model, not hidden in aggregate uptime.

## Inputs and outputs

Inputs are instrumented [[Frontend]], [[Backend]], workers, dependencies, and normalized provider metadata. Outputs are dashboards, alerts, traces, cost/quality reports, and rollback evidence.

## Failure behavior

Telemetry failure must not corrupt business state. Buffer within bounds, degrade gracefully, and retain enough local correlation to investigate; alert on aged credit reservations and failed object processing.

## Phase 8 operational signals

Alert on sustained HTTP 5xx, database readiness failure, AI Router failures,
Redis coordination unavailability, provider timeout/rate-limit spikes, stale
running executions, pending credit reconciliation, and file-processing failure
or backlog. These are recommended alert categories only; no external alert
delivery is claimed by the repository. Logs should correlate request, workspace,
conversation, request group, run, provider, and model using safe identifiers,
while excluding prompt/document content and credentials.

## Security considerations

Redact content and credentials, control dashboard access, define telemetry retention, avoid high-cardinality user identifiers, and audit sensitive operational access.

## Scalability considerations

Sample high-volume traces without losing errors or credit paths; aggregate provider metrics by stable registry keys; scale collectors independently when justified.

## Related notes

[[Evaluation-Engine]] · [[Credits-Billing]] · [[Redis]] · [[Deployment]] · [[Testing]]

## Open Questions

- Which observability and error-tracking vendors will be used?
- What exact SLO measurement windows, alert thresholds, and on-call ownership apply?
