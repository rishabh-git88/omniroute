# ADR-001: Monorepo and Modular Monolith

#decision #architecture

- Status: Accepted; deployable layout superseded in part by [[ADR-004-FastAPI-Router-Service]]
- Date: 2026-09-06
- Source: `references/architecture-source.txt`, sections 4 and 10

## Context

The first release needs synchronized web/API contracts, multiple provider adapters, background jobs, transactionally safe credits, and clear service boundaries, while remaining affordable and fast to debug.

## Decision

Use a monorepo with deployable applications and explicit packages for contracts, provider boundaries, UI, observability, and typed configuration. Implement product business logic as a NestJS modular monolith with repository interfaces inside each module. [[ADR-004-FastAPI-Router-Service]] adds a Python/FastAPI orchestration service while retaining this monorepo and modular-monolith decision for product state.

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
