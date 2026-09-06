# Current Sprint: Project Foundation

#roadmap

## Sprint goal

Prepare an implementation-ready project foundation while preserving the architecture boundaries in [[ADR-001-Monorepo]], [[ADR-002-PostgreSQL]], and [[ADR-003-AI-Router]]. This sprint does not implement product features beyond the minimum foundation needed to prove the stack and contracts.

## Scope

- Confirm unresolved foundation choices from [[Roadmap#Open Questions]].
- Define the monorepo/app/package layout, ownership boundaries, naming, and dependency rules.
- Pin the approved Node.js, pnpm, Turborepo, Next.js, NestJS, Prisma, PostgreSQL, and Redis versions after re-verification.
- Specify generated API/event contracts and provider-neutral core types.
- Design the initial database migration for identity, workspace, and conversation skeletons without prematurely filling later domain behavior.
- Plan local Docker Compose dependencies and fake provider adapters.
- Establish lint, formatting, typecheck, unit-test, secret-scan, and CI conventions.
- Specify environment configuration, secret handling, telemetry correlation IDs, and health endpoints.
- Document Google OAuth/session approach and workspace authorization boundary.

## Deliverables

- Approved foundation decisions or new ADRs for material choices.
- Scaffold plan consistent with [[System-Architecture]] and [[Backend]].
- Initial schema/API/provider contracts reviewed against [[Security]] and [[Testing]].
- Local-development and CI acceptance checklist.
- Updated knowledge-base links and resolved/open questions.

## Acceptance criteria

- Every planned dependency points inward through an explicit module/package boundary.
- Provider SDK imports are confined to adapter packages.
- PostgreSQL remains the only durable business-state authority; Redis usage has recovery behavior.
- REST/SSE, idempotency, branch, context, and credit invariants have named contract/test locations.
- Secrets and environment configuration have a validated, server-only design.
- No application feature implementation has begun as part of this documentation bootstrap.

## Out of scope

Live provider integration, comparison UI, production context summarization, semantic retrieval, billing execution, file processing, deployment, ML routing, and application feature implementation.

## Dependencies

[[Roadmap]] · [[MVP-Scope]] · [[Docker]] · [[CI-CD]] · [[API-Design]]

## Open Questions

- Confirm pnpm/Turborepo and the selected managed services before scaffolding.
- Confirm whether the initial migration includes credit tables or leaves them for the credits milestone.
- Confirm the OAuth/session library and whether a workspace is created automatically for every user.
