# System Architecture

#architecture

## Purpose

OmniRoute starts as a modular monolith with independently testable provider adapters and background workers. The platform owns state; providers are replaceable inference engines.

```mermaid
flowchart TB
    U[Browser] -->|REST commands| WEB[Next.js Web App]
    WEB -->|REST and SSE| API[NestJS API / Fastify]
    API --> ID[Identity]
    API --> CONV[Conversation Module]
    API --> CTX[Context Module]
    API --> ROUTER[AI Router / Provider Orchestrator]
    API --> USAGE[Usage and Credits]
    API --> FILES[Files and Artifacts]
    ROUTER --> OPENAI[OpenAI Adapter]
    ROUTER --> ANTHROPIC[Anthropic Adapter]
    ROUTER --> GEMINI[Gemini Adapter]
    CONV --> PG[(PostgreSQL)]
    CTX --> PG
    USAGE --> PG
    API --> REDIS[(Redis / BullMQ)]
    FILES --> OBJ[(Object Storage)]
    API --> OTEL[Telemetry]
    WORKER[Background Worker] --> REDIS
    WORKER --> PG
    WORKER --> OBJ
    WORKER --> OTEL
```

## Responsibilities

- [[Frontend]] owns the consistent user experience and presentation state.
- [[Backend]] owns identity, conversations, context, providers, usage, files, policy, analytics, and streaming module boundaries.
- [[AI-Router]] orchestrates comparisons and eligibility; [[Provider-Layer]] alone imports provider SDKs.
- [[Context-Memory]] owns provider-neutral branch resolution and context packages.
- [[PostgreSQL-Schema]] owns durable history and money-like invariants.
- [[Redis]] accelerates ephemeral coordination but never becomes the only copy of a selected branch or credit transaction.
- Object storage holds file bytes and large artifacts; PostgreSQL stores their metadata.

## Inputs and outputs

Inputs are authenticated REST commands, file-upload intents, selections, switches, cancellations, and provider stream events. Outputs are REST representations, normalized SSE events, signed object access, durable records, and telemetry.

## Failure behavior

Provider calls fail independently. Durable state remains recoverable when Redis or an SSE connection fails. Credit uncertainty fails closed, terminal runs are reconciled, and background tasks are idempotent.

## Security considerations

Enforce workspace authorization at every boundary, keep secrets server-side, use short-lived signed object URLs, and never execute model output directly. See [[Security]].

## Scalability considerations

Scale the web, API, and worker deployables independently first. Extract services only from measured bottlenecks. Kubernetes, Kafka, a service mesh, and multi-region active-active are deferred.

## Implementation notes

The target stack is TypeScript, Next.js 16/React 19, NestJS 11/Fastify on Node.js 24 LTS, Prisma plus explicit SQL, PostgreSQL 18, Redis/BullMQ, and S3-compatible storage. Re-verify versions before implementation.

## Related notes

[[ADR-001-Monorepo]] · [[ADR-002-PostgreSQL]] · [[API-Design]] · [[Deployment]] · [[Observability]]

## Open Questions

- Which managed API/worker host and which managed data vendors will be used for MVP?
- Is the worker deployed from day one or initially run as a separate process from the same backend codebase?
