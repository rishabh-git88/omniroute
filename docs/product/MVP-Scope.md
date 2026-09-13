# MVP Scope

#product #roadmap

## In V1

- Google login, chat history, and a stable workspace shell.
- Compare 3 and Single AI modes with independent streaming states.
- OpenAI, Anthropic, Gemini, Groq, and OpenRouter adapters behind
  [[Provider-Layer]], with runtime availability controlled by configuration and
  the reviewed [[Model-Registry]].
- Explicit response selection, active branch persistence, and provider switching.
- Provider-neutral context using recent turns plus a versioned summary.
- Text, files, a capability registry, and basic image-aware routing.
- Platform credits, reservations, usage ledger, quotas, and provider fallback controls.
- REST commands, multiplexed SSE, reconnect support, per-run cancellation, and partial failure UX.
- PostgreSQL, pgvector retrieval for TXT/Markdown/text-layer PDF workspace files,
  private object storage, observability, Docker, CI/CD, and managed deployment.

## Explicitly later

- Consumer ChatGPT Plus, Claude Pro, or Gemini subscription inheritance.
- Autonomous councils or debate agents.
- An ML-trained router or personalized Auto Pick.
- Every provider and every provider-native tool.
- Kubernetes, Kafka, service mesh, event sourcing, separate vector database, or multi-region active-active.
- BYOK/account connections, comparison summaries, team workspaces, OCR, office
  document ingestion, reusable agents, and tool packs until evidence supports them.

## MVP exit criteria

The core loop—ask three, choose one, continue, and switch without re-explaining—works across desktop and mobile. Branch selection, context handoff, credits, file access, streaming isolation, and observability meet [[Testing#MVP acceptance criteria|the acceptance criteria]].

## Scope control

Provider/model details live in [[Model-Registry]]. Semantic retrieval remains optional per [[Vector-Memory]]. Infrastructure evolves only through measured need and an ADR.

## Related notes

[[Product-Vision]] · [[Roadmap]] · [[Current-Sprint]] · [[ADR-001-Monorepo]]

## Open Questions

- Which file types and maximum sizes are included in the first demonstrable release?
- Is basic image-aware routing input analysis only, or does V1 include image generation?
