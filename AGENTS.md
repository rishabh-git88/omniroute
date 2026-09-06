# OmniRoute agent guide

OmniRoute is a provider-neutral, multi-LLM conversation workspace: ask several models, select a response, continue on the selected branch, and switch providers without losing relevant saved context.

## Context retrieval

1. Read this file first.
2. Use [docs/00-OmniRoute-Hub.md](docs/00-OmniRoute-Hub.md) ([[00-OmniRoute-Hub]]) as the documentation entry point when architecture context is needed.
3. Follow only the wiki-linked notes relevant to the task; do not load the entire knowledge base by default.
4. Treat `references/architecture-source.txt` as the authoritative product-architecture source when a note is unclear.

## Architecture rules

- Start as a modular monolith and preserve module boundaries.
- Keep business logic independent of AI-provider SDKs.
- Route every provider call through the [[Provider-Layer]].
- Use the [[AI-Router]] for automatic model selection; user-selected calls still pass through provider orchestration.
- Keep conversation history, context snapshots, and artifacts provider-neutral.
- PostgreSQL is the primary system of record. Redis stores only ephemeral, cached, queued, and real-time coordination state.
- Keep model capabilities and pricing in the versioned [[Model-Registry]], not scattered conditionals.
- Preserve transactional, auditable credit reservations and reconciliation.
- Use REST for commands and multiplexed SSE for V1 streaming.

## Documentation map

- Product and scope: `docs/product/`
- Runtime architecture: `docs/architecture/`
- Persistence: `docs/data/`
- APIs, security, testing, observability: `docs/engineering/`
- Delivery and operations: `docs/devops/`
- Decisions: `docs/decisions/`
- Delivery sequence: `docs/roadmap/`

## Change discipline

Significant architectural changes require a new ADR in `docs/decisions/`. Update the affected notes and their wiki links whenever implementation changes architecture. Record unresolved choices under `## Open Questions`; do not silently invent decisions.
