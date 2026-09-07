# Docker

#devops

## Purpose

Provide repeatable local dependencies and production container images for the API and worker without prematurely introducing an orchestrator.

## Responsibilities

- Docker Compose runs local PostgreSQL with pgvector and ephemeral Redis. Object storage is added with the file milestone; provider calls use mocks or developer-owned keys in secret storage.
- Multi-stage builds create non-root web, API, and AI Router runtime images.
- Runtime containers use non-root users, health endpoints, immutable tags, and minimal base images.
- Build context excludes secrets, local data, and unnecessary source artifacts.

## Inputs and outputs

Inputs are pinned dependency lockfiles, application build artifacts, environment configuration schemas, and health contracts. Outputs are reproducible images and a local dependency environment.

## Dependencies

[[Backend]], [[PostgreSQL-Schema]], [[Redis]], [[CI-CD]], and [[Deployment]].

## Failure behavior

Health checks distinguish startup, readiness, and liveness where supported. Containers fail early on invalid configuration and shut down gracefully so streams/jobs can reach a recoverable state.

## Security considerations

No secrets or production data in images/Compose. Scan images and dependencies, generate an SBOM, drop unnecessary privileges, and pin production base images.

## Scalability considerations

Keep API and worker images/process roles separately scalable even if built from one monorepo. Do not add Kubernetes until operational evidence justifies it.

## Implementation notes

Image definitions live under `infrastructure/docker/`; local database initialization lives under `infrastructure/postgres/init/`. Application containers are opt-in through the Compose `application` profile.

## Related notes

[[ADR-001-Monorepo]] · [[Security]] · [[Testing]]

## Open Questions

- Which S3-compatible emulator is added with the file milestone?
- What retention and security policy should apply to build provenance and runtime images?
