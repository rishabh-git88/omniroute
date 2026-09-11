# CI/CD

#devops

## Purpose

Build, verify, scan, preview, migrate, deploy, smoke-test, observe, and safely roll back OmniRoute through GitHub Actions and infrastructure-as-code.

## Pipeline

```mermaid
flowchart LR
    A[Pull request] --> B[Lint and typecheck]
    B --> C[Unit and integration tests]
    C --> D[Security and secret scans]
    D --> E[Build immutable containers]
    E --> F[Preview deploy]
    F --> G[Migration dry run]
    G --> H{Manual production approval}
    H --> I[Controlled migration]
    I --> J[Deploy API and worker]
    J --> K[Deploy web]
    K --> L[Smoke tests]
    L --> M[Observe]
    M -->|regression| N[Rollback application safely]
```

## Implemented CI gates

`.github/workflows/ci.yml` runs independent GitHub Actions jobs for linting
(including Python formatting), TypeScript/Python type checks, frontend tests,
backend unit tests, AI Router tests, and PostgreSQL-backed migration and
integration tests. The final build job depends on all gates, validates the
Compose configuration, builds every deployable, and validates all production
Dockerfiles.

Frontend and API test jobs run through Turbo's dependency graph so exported
shared packages are built first. The build environment explicitly supplies the
synthetic `NEXT_PUBLIC_API_URL=https://api.ci.invalid`; it uses no production
credentials.

The integration job bootstraps restricted, marked `omniroute_integration` and
`omniroute_integration_upgrade` databases. It builds API workspace dependencies,
rehearses the two-migration upgrade with retained data, validates Prisma and
migration checksums/catalog objects/drift, and executes all database suites.
See [[Database-Verification]] and [[ADR-011-Isolated-Database-Verification]] for
the fail-closed targeting rules. The old `omniroute_test` is not used.

The build job runs `scripts/verify-images.sh` for image builds and isolated,
synthetically configured non-root startup checks. Source changes to CI are not
evidence that a GitHub-hosted run passed; the reviewed revision still needs its
own green run. The fixed release architecture uses Vercel and AWS ECS/Fargate
with GitHub OIDC; provisioning and CD are later gates, outside Milestone 2.

## Responsibilities

- Pin toolchains and dependencies; cache without bypassing correctness.
- Run deterministic test gates from [[Testing]] and bounded provider smoke tests separately.
- Build/sign/scan immutable images and retain provenance/SBOM.
- Create production-free, short-retention, spend-capped previews.
- Rehearse migrations and use expand-migrate-contract for breaking schema changes.
- Require explicit production approval, then observe release health.

## Inputs and outputs

Inputs are commits, workflow definitions, lockfiles, migration files, IaC, test fixtures, and environment secrets. Outputs are checks, preview URLs, signed images, migration evidence, deployments, and release records.

## Dependencies

[[Docker]], [[Deployment]], [[PostgreSQL-Schema]], [[Security]], and [[Observability]].

## Failure behavior

Stop on failed gates. Do not roll back a non-backward-compatible schema blindly; use compatible application rollback and forward-fix or explicitly designed migration recovery.

## Security considerations

Use least-privilege short-lived CI credentials, protected environments, branch protections, secret scanning, dependency scanning, signed artifacts, and no production data in previews.

## Scalability considerations

Parallelize independent checks, shard only measured slow suites, and keep deployment concurrency locked per environment.

## Open Questions

- Which IaC tool and artifact/container registry will be used?
- What branch protection, approver, preview, and rollback policies are required?
