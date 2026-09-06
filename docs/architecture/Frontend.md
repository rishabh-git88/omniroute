# Frontend

#architecture #frontend

## Purpose

Provide one stable Next.js workspace for comparison, response selection, continuation, switching, history, usage, files, and settings.

## Responsibilities

- Render Home, Comparison Result, Active Conversation, Switch Model, History, Usage, and Settings.
- Consume [[API-Design|REST commands and multiplexed SSE]], demultiplex events by run ID, and reconnect with `Last-Event-ID`.
- Maintain independent loading, streaming, failure, retry, and cancellation states per run.
- Make the active response, branch, provider, model, latency, usage, and context handoff visible.
- Use TanStack Query for server state and a small local store only for transient UI state.
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

Use tabs or a carousel on mobile, with an optional desktop split view. Selection may occur after the first completion and does not wait for the slowest run.

## Related notes

[[User-Flows]] · [[Backend]] · [[Security]] · [[Testing]] · [[Deployment]]

## Open Questions

- What exact responsive breakpoint enables the optional split comparison view?
- Should a selection automatically cancel remaining runs or require a separate user action?
