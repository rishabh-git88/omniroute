# Database Verification

## Disposable integration environment

From the repository root:

```sh
docker compose -f compose.integration.yaml up -d --wait
pnpm --filter '@omniroute/api^...' build
NODE_ENV=test DATABASE_TEST_URL=postgresql://omniroute_integration:integration-only@127.0.0.1:55432/omniroute_integration_upgrade pnpm --filter @omniroute/api db:verify-upgrade
NODE_ENV=test DATABASE_TEST_URL=postgresql://omniroute_integration:integration-only@127.0.0.1:55432/omniroute_integration pnpm --filter @omniroute/api test:database
```

These credentials are synthetic and exclusive to the disposable instance.
Use a dedicated test shell. An inherited `DATABASE_URL` must be absent or exactly
match the selected safe test URL; the runner refuses an inherited development or
production URL. Do not bypass this refusal by repointing the developer database.
`NODE_ENV`, when supplied, must be `test`.

The independent `omniroute-integration` project publishes loopback port 55432
(override with `INTEGRATION_POSTGRES_PORT`). It uses tmpfs, no named database
volume, and an initialization file that creates a non-superuser role with no
database/role creation privileges. Its databases are explicitly marked
`omniroute:disposable-integration:v1`. Only the exact integration database names
and recognized local hosts are allowed; arbitrary URL query parameters are
rejected. The runner and every integration suite verify server identity before
writes. Prisma's test configuration also performs the URL guard; use the runner
for the additional server-marker check before migration commands.

The `_upgrade` rehearsal requires a fresh database and runs once per disposable
instance. It installs core, inserts synthetic workspace memory, applies memory
changes, and verifies preservation. Rerunning against a populated upgrade target
fails without reset. The main integration target can be reused: its tests
truncate **only its disposable domain data**. Do not run concurrent direct Vitest
processes against it; use the serialized runner.

Neither the developer database `omniroute` nor the old `omniroute_test` is an
integration target. The separate Compose file is required; do not use the root
Compose project's teardown or volume operations to manage test infrastructure.

## Migration gates

- `pnpm --filter @omniroute/api db:validate`: Prisma schema validation without a
  live database or credentials.
- Both database runners verify migration history/checksums, deployment/status,
  Prisma drift, pgvector, `memories.source_hash`, the memory validity/version
  index, the embedding identity replacement, text GIN, and vector HNSW indexes.
- `test:database` generates Prisma and executes core, auth, conversation, and
  registry integration suites sequentially. Missing database configuration is a
  failure, not a skipped suite.
- Unit tests exercise URL/identity refusal, modified/failed/unknown migration
  history, and seed configuration. Auth/provider network behavior in integration
  tests uses deterministic mocks; these are not live Google/provider checks.

## Development alignment

The Milestone 2 local repair verified the Compose service/project, database role
and name, and existing migration checksum before writes. A custom-format
`pg_dump` with restrictive file permissions was retained outside the repository.
Only the pending memory migration and canonical provider metadata were applied.
Before/after fingerprints verified all 29 non-provider domain tables unchanged;
provider IDs and enabled flags were preserved. No reset or history rewrite ran.

For future local seed operations, explicitly configure the loopback `omniroute`
database using role `omniroute`. `db:seed` is a development fixture seed and also
creates the existing fake models/local grant. For metadata-only reconciliation,
use `pnpm --filter @omniroute/api db:seed:registry`. Neither command is an approved
production seeding procedure. Back up and inspect drift before future repairs.

## Reviewed real-model seed configuration

`MODEL_REGISTRY_SEED_FILE` may identify a local JSON file for `db:seed:registry`.
Without it, only canonical OpenAI, Anthropic, and Gemini provider metadata is
aligned: **no real model or price is invented**. The minimal file is:

```json
{ "models": [] }
```

Each configured model must supply these fields, validated by
`packages/config/src/registry-seed.ts`:

| Field | Required value |
| --- | --- |
| `provider` | `openai`, `anthropic`, or `gemini` |
| `modelKey`, `providerModelId`, `displayName` | Stable provider-prefixed internal key and reviewed provider identity/name |
| `registryVersion` | Positive integer; increment for a changed snapshot |
| `capabilities` | Input/output modalities, files/images/search/tools booleans, context window and maximum output tokens |
| `pricing` | USD; explicit nonnegative decimal strings `inputPerMillionTokens` and `outputPerMillionTokens` (up to eight decimal places); HTTPS `sourceUrl` and ISO `reviewedAt` |
| `pricingVersion`, `effectiveAt` | Explicit pricing revision and ISO effective time |
| `regionConstraints` | Explicit string array; empty only when that is the reviewed configuration |

No fields imply default prices. A zero must be explicitly provided with
provenance. Validation checks structure, not the truth or freshness of a supplied
price. Test fixture prices are synthetic and are never copied into real-provider
defaults. Duplicate versions, changed snapshot content at the same version,
changed stable model identity, and enablement fields are rejected. New registry
entries remain disabled; existing provider enablement is not changed.

## Release commands

After frozen JS/Python installation and isolated database initialization, run:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @omniroute/api db:validate
# Run the two database commands above against their dedicated targets.
NEXT_PUBLIC_API_URL=https://api.ci.invalid pnpm build
docker compose --profile application config --quiet
docker compose -f compose.integration.yaml config --quiet
bash scripts/verify-images.sh
```

The root test task includes AI Router pytest. CI also runs pytest in its own job.
`verify-images.sh` builds all three production images and starts network-isolated
containers using synthetic configuration, no ports, and no data mounts. It checks
API liveness, the configured web login URL, router readiness, and non-root users,
then removes only the containers it created. API readiness with real backing
services and production deployment remain separate gates.

## Related notes

[[ADR-011-Isolated-Database-Verification]] · [[CI-CD]] · [[Testing]]
· [[PostgreSQL-Schema]] · [[Model-Registry]] · [[CURRENT-STATE]]
