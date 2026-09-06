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

## Security considerations

Redact content and credentials, control dashboard access, define telemetry retention, avoid high-cardinality user identifiers, and audit sensitive operational access.

## Scalability considerations

Sample high-volume traces without losing errors or credit paths; aggregate provider metrics by stable registry keys; scale collectors independently when justified.

## Related notes

[[Evaluation-Engine]] · [[Credits-Billing]] · [[Redis]] · [[Deployment]] · [[Testing]]

## Open Questions

- Which observability and error-tracking vendors will be used?
- What exact SLO measurement windows, alert thresholds, and on-call ownership apply?
