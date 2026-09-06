# Development Roadmap

#roadmap

## Build order

Reliable provider adapters → parallel streaming → response selection → active branch → context handoff → ledger accounting → files and capabilities → evaluation data → smart recommendations.

## Foundation

- Establish the monorepo, Next.js shell, NestJS API/worker boundaries, shared contracts/config, local PostgreSQL/Redis/object storage, Google login design, CI baseline, and architectural test seams.
- Exit: an authenticated user can create and reopen a conversation using local infrastructure and fake providers.
- Detailed documentation-only planning is in [[Current-Sprint]].

## Focused demonstrable MVP

1. Implement canonical provider interface and fake/live OpenAI, Anthropic, Gemini adapters; pass shared contract tests.
2. Implement request groups, parallel execution, multiplexed SSE, per-run cancellation, and provider tabs.
3. Persist turns, runs, candidate responses, selection, and active branch.
4. Assemble recent history plus versioned summary; switch providers coherently.
5. Add transactional credit reservations, usage reconciliation, limits, and partial-failure UX.
6. Complete tests, security checks, Docker, delivery pipeline, managed deployment, observability, and demo documentation.

The source presents this as days 2–7 after foundation, but it also warns that seven days yields a portfolio MVP, not a trustworthy commercial release.

## Production-minded extension

- Weeks 2–3: reconnect hardening, file lifecycle, summary versioning, registry UI, spend controls, accessibility, export/delete.
- Weeks 4–5: load tests, prompt/output safety, team workspaces, analytics/cost dashboards, runbooks, backup/restore drills.
- Week 6: closed beta, task-specific evals, onboarding/pricing experiments, provider failure drills, support workflow.

## Later, only after evidence

BYOK/account connections, comparison summaries, personalized Auto Pick, workspaces/RAG beyond the production extension, reusable agents, domain tool packs, and larger-scale infrastructure.

## Release principles

Each stage protects the ask-three/select/continue/switch loop and satisfies [[Testing]]. Version/provider details are rechecked before implementation. Architectural changes update notes and receive an ADR.

## Related notes

[[MVP-Scope]] · [[System-Architecture]] · [[Deployment]] · [[Evaluation-Engine]]

## Open Questions

- Which managed hosting, database, Redis, object-storage, and observability vendors are selected?
- What exact V1 model list, pricing-to-credit conversion, partial-charge, fallback, and cancellation policies apply?
- What file types/sizes, image capabilities, content controls, retention defaults, and data regions are in V1?
- What initial context budgets, summarization model/triggers, embedding choice, and memory scope apply?
- What concrete load targets, SLO ownership, recovery objectives, browser/device matrix, and beta evaluation tasks define readiness?
- Is the source's seven-day sequence a hard calendar commitment or only a recommended order of work?
