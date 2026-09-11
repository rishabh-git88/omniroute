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

The development PostgreSQL init scripts enable pgvector and retain the legacy
`omniroute_test` creation on a fresh volume. That database is no longer accepted
by integration tests. Prisma migrations own application tables; development
migrations and seeds require an explicitly configured local target.

`compose.integration.yaml` creates a separate tmpfs PostgreSQL project on
loopback port 55432 with a restricted role and marked disposable databases. It
does not mount the development volume. `pnpm db:test` verifies both URL and
server identity before migration or truncation. Upgrade verification uses its
own fresh database and refuses reset. See [[Database-Verification]].

All three runtime images are multi-stage, run as the unprivileged `omniroute`
user, and contain image-level readiness health checks. `.dockerignore` keeps
local secrets, build output, dependency directories, and local database data
out of the image context. `compose.yaml` remains the local development
environment: dependencies start by default; `--profile application` adds the
API, AI Router, and web images.

`scripts/verify-images.sh` builds all images and checks isolated startup using
synthetic configuration, no published ports, and no database mounts. It cleans
up only its own temporary containers. API startup checks liveness without
backing services; this is not an API readiness or deployed-system test. JS builds
use a shared BuildKit pnpm download cache, frozen installation, bounded download
concurrency, and an explicit configured web origin. Nested environment files are
excluded from the Docker context.

## Related notes

[[ADR-001-Monorepo]] · [[Security]] · [[Testing]]

## Open Questions

- Which S3-compatible emulator is added with the file milestone?
- What retention and security policy should apply to build provenance and runtime images?
