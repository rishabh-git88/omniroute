# Frontend

#architecture #frontend

## Purpose

Provide one stable Next.js workspace for comparison, response selection, continuation, switching, history, usage, files, and settings.

## Responsibilities

- Render Home, Comparison Result, Active Conversation, Switch Model, History, Usage, and Settings.
- Consume [[API-Design|REST commands and multiplexed SSE]], demultiplex events by run ID, and reconnect with `Last-Event-ID`.
- Maintain independent loading, streaming, failure, retry, and cancellation states per run.
- Make the active response, branch, provider, model, latency, usage, and context handoff visible.
- Use the API as the source of server state and local React state only for
  transient composer, stream, dialog, and layout state.
- Provide keyboard-accessible and mobile-first comparison behavior.

## Inputs

User prompts, file choices, selected providers, response selections, switch targets, retries, cancellations, and privacy/settings choices.

## Outputs

Validated commands to [[Backend]], upload intents to object storage, and accessible UI driven by normalized API representations and events.

## Dependencies

Next.js 16 App Router, React 19, TypeScript, Tailwind CSS, shadcn/ui, generated contracts, [[API-Design]], and [[Model-Registry]]. Versions must be rechecked before implementation.

## Data used

Conversation summaries, turns and candidates, provider/model descriptors, run statuses, credit estimates and actuals, file metadata, and account settings. Database models must not be shared directly with the UI.

## Failure behavior

Keep completed responses visible when peers fail; display per-run retry/cancel controls. On SSE disconnect, reconnect within the retained window, then fetch durable run state if replay is unavailable.

## Security considerations

Do not expose provider keys. Sanitize Markdown/HTML, avoid permanent public file URLs, render tool proposals without executing them, and protect authenticated mutations against CSRF where applicable.

## Scalability considerations

Avoid retaining complete streams in global client state. Paginate history, virtualize long conversations if needed, and treat the API as the source for terminal run state.

## Implementation notes

Compare cards use a desktop grid and stack on narrow screens. Selection may
occur after the first completion and does not wait for the slowest run.

The MVP supplies an authenticated sidebar, chat route, model selector, message
composer, stream decoder, stop control, and regenerate control. It renders
only API representations of canonical turns/responses and model-registry or
routing-decision metadata—never provider SDK data or credentials. Terminal
SSE handling refreshes PostgreSQL-backed conversation state.

Each completed response exposes a one-click “Try another AI” action and a
“Continue with this answer” selection action. Provider and model labels remain
visible on every candidate. Selecting a response highlights it as the preferred
continuation without removing its alternatives.

## Phase 7 product behavior

The authenticated workspace is one server-backed flow: persisted conversation
history and files load on entry; a new conversation may be Single AI or Compare
3; the composer sends its selected Economy, Smart, or Max mode with every
command. The model picker lists only server-provided registry models and
disables unhealthy choices. Compare cards are keyed by `runId`, so interleaved
SSE events, failures, cancellation, and reconnecting state remain independent.

Compare 3 is deliberately unavailable when the API returns
`COMPARE_REQUIRES_THREE_ELIGIBLE_MODELS`. The browser shows that reviewed-model
gate and leaves Single AI usable; it never creates a fake third response.

The browser reconnects request-group SSE with the last received event position
and reloads the durable conversation after a terminal stream or exhausted
retries. A page refresh only restores persisted state and subscribes to active
runs; it never dispatches a new provider call. Per-run cancellation and group
cancellation are separate commands. Errors are rendered from normalized server
codes, not raw provider, parser, or storage text.

Workspace file controls show server-reported processing state. A file is only
described as available for retrieval when it is `READY`; production embedding
and storage configuration errors are shown honestly. The UI never receives
object keys, vector identifiers, or permanent file URLs.

## Related notes

[[User-Flows]] · [[Backend]] · [[Security]] · [[Testing]] · [[Deployment]]

## Release Milestone 1 browser boundary

[[ADR-010-Browser-API-Auth-Boundary]] defines the implemented environment/session
behavior. `NEXT_PUBLIC_API_URL` is a statically accessed, validated API origin;
`/v1` is appended by the web client. Development/test mode defaults to
`http://localhost:4000` only when the value is absent. Empty/invalid values fail.
Production requires an explicit HTTPS DNS origin, never falls back to a local
host, and rejects IP literals, URL credentials, paths, queries, and fragments.
The public origin is compiled into browser and server bundles: rebuild when it
changes. Login derives its Google link from this origin alone.

The public landing renders immediately during the bounded background session
check. HTTP 401 shows anonymous state; outage/timeout displays a retryable
unavailable state, including on login and protected workspace pages. The existing
O branding is provided by `app/icon.svg`; `/favicon.ico` redirects to it.

After a configured build, `pnpm --filter @omniroute/web test:production` runs a
local production/browser smoke test. Supply the same `NEXT_PUBLIC_API_URL` used
at build time and an installed Chromium executable through `CHROME_BINARY` if
`google-chrome` is unavailable. The script intercepts session requests and uses
no real provider/OAuth credentials. It intentionally supplies a conflicting
runtime API URL to detect accidental runtime overrides.

## Open Questions

- Should a selection automatically cancel remaining runs or require a separate user action?
