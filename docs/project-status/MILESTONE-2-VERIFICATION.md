# Release Milestone 2 Verification

Date: 2026-09-10. Scope: **Database Alignment and CI Repair**.
Base revision: `a15e0c4` (`fix: harden frontend auth and API boundary`), plus the
uncommitted Milestone 2 working-tree changes. No commit or AWS work was performed.

Local toolchain: Node.js 22.22.2, pnpm 12.3.4, Python 3.14.4. CI and Node images
pin Node.js 24.20.0; the fresh-source local test proves task ordering on the
supported local Node version, while the Docker builds verify compilation on 24.

Overall status: **PARTIAL**. The local database work is COMPLETE and the CI
implementation is repaired. All application checks pass. API/web container
startup and a GitHub-hosted run remain open; do not call the release gate green.

## Verification results

| Check | Status | Observed result |
| --- | --- | --- |
| Frozen JS installation | COMPLETE | Frozen install succeeds; fresh temporary source copy also installs from the local cache with no lockfile changes. |
| Frozen Python installation | COMPLETE | `uv --cache-dir .uv-cache sync --project services/ai-router --all-groups --frozen` passes. |
| `pnpm lint` | COMPLETE | All workspace lint tasks, Prettier, and Ruff formatting pass, including the new database scripts. |
| `pnpm typecheck` | COMPLETE | TypeScript, tooling/config scripts, and Python mypy pass. |
| `pnpm test` | COMPLETE | 132 TS/JS tests and 22 AI Router Python tests pass. Packages with no tests are not counted as test coverage. |
| Fresh-source frontend/API CI graph | COMPLETE | Turbo test command with both application filters passes all six tasks with zero cache hits; dependency exports are built before tests. The source copy contained no existing build outputs or real environment files. |
| Prisma validation | COMPLETE | Schema validation and generation pass. |
| Fresh migration installation | COMPLETE | Both original migrations applied on the separate main integration database. History checksums, status, Prisma diff, and custom memory catalog checks pass. |
| Core-to-memory upgrade | COMPLETE | Fresh dedicated upgrade database receives core, retains a synthetic workspace memory through the second migration, and passes status/checksum/catalog/drift verification. |
| Database integration suites | COMPLETE | 20 tests in four files execute and pass: core invariants/credits, mocked-Google auth, mock-provider conversations, and registry seeding. |
| Development alignment | COMPLETE | Restricted backup precedes the pending migration and provider reconciliation. No Prisma drift; 29 non-provider table fingerprints unchanged; provider IDs and enablement preserved. |
| Configured production build | COMPLETE | `NEXT_PUBLIC_API_URL=https://api.ci.invalid pnpm build` passes all seven tasks, including the Next.js production build, NestJS build, and router wheel. |
| Compose configuration | COMPLETE | Root application profile and separate integration Compose configuration both pass `config --quiet`. |
| API Docker build | COMPLETE | Production Dockerfile builds, deploys production dependencies, and exports its image successfully. |
| Web Docker build | COMPLETE | Production Dockerfile builds using the explicit synthetic HTTPS API origin and exports its image successfully. |
| Router Docker build/startup | COMPLETE | Separate retry builds the image; a network-isolated container passes readiness and runs as `omniroute`. The temporary container is removed after testing. |
| API/web Docker startup | BLOCKED | The combined image check encounters host storage exhaustion before startup. The earlier exported API/web images are absent on subsequent inspection; startup cannot be claimed. |
| GitHub-hosted repaired workflow | BLOCKED | The current changes are uncommitted and unpushed. No remote run validates this working tree. |

The checks above are bounded local evidence. They do not verify live Google,
paid providers, RDS version compatibility, deployment, or the full release feature
set. These remain in [[RELEASE-BLOCKERS]].

## Database changes and preservation

Inspected both complete migration files:

- `apps/api/prisma/migrations/202609070001_core_domain/migration.sql`
- `apps/api/prisma/migrations/202609080001_workspace_memory/migration.sql`

Neither file was edited. The development database had only core applied; the
memory migration was pending. The repair first checked the local Compose
project/service identity, database name/role, and applied checksum, then created a
custom-format backup with restricted permissions. It applied the pending
migration with Prisma deploy, reconciled provider metadata without running the
full development fixture/grant seed, and verified preservation.

The development backup is retained locally at
`/tmp/omniroute-m2-development-backup-C9PF28/development.dump`; before/after
fingerprints are in the same restricted temporary directory. It is not a durable
off-machine backup and its contents are intentionally not printed or committed.

The real-provider rows are `openai`, `anthropic`, and `gemini`; no real-model
prices were supplied and no providers were enabled. The existing fake provider
and model records were preserved. The original populated `omniroute_test`
database was not used. Development containers and their volumes were not removed.

## Tests added

49 unit tests and four database integration tests were added:

- `integration-safety.test.ts`: 16 URL/environment targeting cases, including a
  safe test URL combined with a development, production, or unknown `DATABASE_URL`.
- `integration-identity.test.ts`: eight server-marker/role/identity refusal cases,
  including refusal before connecting for unsafe configuration.
- `development-safety.test.ts`: nine local seed targeting cases.
- `migration-verification.test.ts`: five cases for exact applied SQL, changed
  checksum, failed/unknown history, missing migrations, and rolled-back history.
- `packages/config/src/registry-seed.test.ts`: 11 explicit-price/provenance,
  identity/version, duplicate, and enablement validation cases.
- `provider-seed.integration.test.ts`: four real-PostgreSQL cases covering
  reference-preserving rename, idempotency/no invented prices, immutable disabled
  registry snapshots, and refusal to merge two populated provider identities.

Existing auth and conversation integration suites now fail on missing database
configuration instead of silently skipping. All integration entry points check
the disposable server identity before writes.

The actual `test:database` command was also executed with a valid synthetic test
URL and each of three unsafe `DATABASE_URL` values (development, production,
unknown). All three exited through the expected refusal before migrations.

## Files changed

| Area | Files and purpose |
| --- | --- |
| CI | `.github/workflows/ci.yml`: dependency ordering, synthetic web origin, restricted integration bootstrap, migration rehearsal, validation, builds, and image smoke gate. |
| Disposable database | `compose.integration.yaml`, `infrastructure/postgres/integration-init.sql`: separate tmpfs instance, restricted role, two marked databases. |
| Database safety/verification | `apps/api/src/database/{integration-safety,development-safety,migration-verification}.ts` and associated unit tests; `apps/api/scripts/test-database.ts`; `apps/api/prisma-test.config.ts`; `apps/api/vitest.integration.config.ts`. |
| Existing integration suites | `apps/api/src/database/core-domain.integration.test.ts`, `apps/api/src/identity/auth.integration.test.ts`, `apps/api/src/conversations/conversation.integration.test.ts`: fail-closed entry guards. |
| Registry seeds | `packages/config/src/registry-seed.ts` and test; `packages/config/package.json`; `apps/api/src/database/provider-seed.ts` and integration test; `apps/api/scripts/seed-registry.ts`; `apps/api/prisma/seed.ts`. |
| Tooling | `apps/api/package.json`, `apps/api/tsconfig.tools.json`: verification commands plus lint/type checks for scripts and Prisma/test configuration. |
| Images | `infrastructure/docker/api.Dockerfile`, `infrastructure/docker/web.Dockerfile`: frozen dependency cache/download configuration; `.dockerignore`: exclude nested secrets/caches; `scripts/verify-images.sh`: attempt all builds and check isolated non-root startup. |
| Generated web declaration | `apps/web/next-env.d.ts`: regenerated by the production Next.js build. |
| Documentation | This record, CURRENT-STATE, RELEASE-BLOCKERS, NEXT-MILESTONE, Database-Verification, ADR-011, and the affected CI/CD, Docker, Testing, PostgreSQL-Schema, and Model-Registry notes. |
| Setup guidance | `README.md` and `.env.example`: guarded integration workflow and synthetic isolated database URL; real environment files are unchanged. |

The unrelated `.obsidian/graph.json` edit was preserved and is not part of this
milestone. No real environment file or lockfile was changed.

## Failures encountered and remaining work

Resolved during verification:

1. Initial Docker dependency downloads timed out. BuildKit caching, lower
   concurrency, and the supported longer timeout allowed API/web builds to finish.
2. An attempted `--fetch-retries` flag is unsupported by the pinned pnpm; it was
   removed before the successful image builds.
3. A local frozen reinstall failed while replacing dependency contents, disrupting
   lint/tests and leaving a missing Tailwind native binary. Restoring dependencies
   from the frozen cache resolved it; lint, tests, typecheck, and production build
   have passing results. No application workaround or lockfile change was used.

Still open:

1. The combined Docker gate reported `no space left on device` while updating
   build activity before the router build/startup phase. API/web exports had
   completed, but those images were no longer available afterward. No unrelated
   Docker images, caches, containers, or volumes were pruned. Router build and
   startup subsequently passed separately. Rerun `bash scripts/verify-images.sh`
   on a host with adequate Docker storage to close the combined artifact/startup
   gate; this result remains BLOCKED rather than inferred successful.
2. Review and explicitly commit/push the change when authorized, then require a
   green GitHub run for that revision. Local results cannot stand in for the
   hosted CI run.

Local diagnostic logs are retained under `/tmp/omniroute-m2-*`. They are temporary
execution evidence; this report preserves the portable conclusions.

## Related notes

[[CURRENT-STATE]] · [[RELEASE-BLOCKERS]] · [[NEXT-MILESTONE]]
· [[Database-Verification]] · [[ADR-011-Isolated-Database-Verification]]
