# ADR-001: Monorepo and Modular Monolith

#decision #architecture

- Status: Accepted
- Date: 2026-09-06
- Source: `references/architecture-source.txt`, sections 4 and 10

## Context

The first release needs synchronized web/API contracts, multiple provider adapters, background jobs, transactionally safe credits, and clear service boundaries, while remaining affordable and fast to debug.

## Decision

Use a TypeScript monorepo with deployable `apps/web`, `apps/api`, and `apps/worker`; packages for contracts, provider core/adapters, UI, observability, and typed configuration; and infrastructure/docs at the root. Implement the backend as a NestJS modular monolith with repository interfaces inside each module.

## Consequences

One repository and one core backend simplify cross-cutting changes, local testing, observability, and early operations. Explicit packages/modules prevent provider types or database models from leaking across boundaries. API and worker processes can scale separately. The team must actively prevent accidental coupling inside the monolith.

## Alternatives considered

- Microservices: rejected for MVP because operational cost precedes measured bottlenecks.
- Next.js route handlers only: rejected because orchestration, workers, ledgers, files, retries, and policies need a dedicated backend boundary.
- Polyrepo: rejected initially because it complicates shared contract evolution and atomic changes.

## Revisit when

A measured reliability, ownership, compliance, or scaling bottleneck warrants extracting a bounded service. Extraction requires a new ADR.

## Related notes

[[System-Architecture]] · [[Backend]] · [[Docker]] · [[Roadmap]]

## Open Questions

- The package manager/build orchestrator is implied as pnpm/Turborepo by the source tree but should be confirmed before scaffolding.
