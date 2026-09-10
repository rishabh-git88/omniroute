# OmniRoute Release Scope

Planning reset: 2026-09-10. This document records the user's fixed initial public
release target. It describes required behavior, not completed implementation.
See [CURRENT-STATE](CURRENT-STATE.md) for evidence,
[RELEASE-BLOCKERS](RELEASE-BLOCKERS.md) for the dependency-ordered backlog, and
[NEXT-MILESTONE](NEXT-MILESTONE.md) for the first execution boundary.

## Authority and boundaries

The release decisions in this document supersede conflicting initial-release
assumptions in older notes, including optional workspace retrieval, deferred raw
file storage, image-aware MVP scope, and an undecided managed container host.
Historical phase numbers are not evidence of completion.

Follow [AGENTS.md](../../AGENTS.md): preserve the NestJS modular monolith's domain
boundaries, use provider-neutral contracts, keep durable state in PostgreSQL,
and route every live provider call through the Provider Layer in the AI Router.
User-selected models also pass through provider orchestration. REST commands
and multiplexed SSE remain the V1 transport.

This planning reset creates four status documents only. Implementation work
must record the resulting architectural decisions in ADRs and update affected
architecture, deployment, scope, and roadmap notes. No application change,
infrastructure deployment, migration, or commit is authorized by these documents
alone.

## Fixed release architecture

| Responsibility | Required release target |
| --- | --- |
| Frontend | Vercel running Next.js |
| Product API | AWS ECS/Fargate running NestJS |
| AI Router and provider adapters | AWS ECS/Fargate running FastAPI |
| Durable relational and vector data | AWS RDS PostgreSQL with pgvector |
| Ephemeral cache and coordination | AWS ElastiCache Redis/Valkey |
| Workspace file bytes | Amazon S3 |
| Server secrets | AWS Secrets Manager |
| Networking | ALB ingress; ECS tasks, RDS, and Redis/Valkey in private networking |
| Monitoring | CloudWatch |
| CI/CD | GitHub Actions using AWS OIDC for AWS access |

The API owns users, authorization, conversations, selected branches, frozen
context snapshots, file metadata, usage, and credit accounting. The AI Router
owns routing and provider execution and must not mutate canonical conversation
or wallet records directly. The browser cannot call the router directly or
receive provider credentials. Private tasks require controlled outbound access
to providers and other necessary external services.

PostgreSQL owns recoverable run and accounting state. Redis/Valkey can coordinate
streams, limits, caches, and provider health; losing it must not erase history,
selected responses, or ledger entries. S3 holds private file objects while
PostgreSQL records ownership, processing state, chunks, and embedding provenance.

ECS image publication, TLS certificates, DNS, service authentication, deployment
roles, and migration execution are required implementation work. The exact IaC
tool, AWS region, domains, and remaining policy choices are listed below rather
than treated as already configured.

## Required features and release acceptance

Every row is required for the initial public release. These criteria are future
acceptance gates; none is a claim that the current product passes them.

| Feature | Required observable behavior |
| --- | --- |
| Public landing page | Anonymous users can open `/` on the production domain without login; navigation, metadata, icons, mobile layout, and loading/error states work. |
| Google authentication | Sign-in, callback, session refresh/expiry, protected routes, CSRF protection, and logout work across the actual Vercel/API domains. Redirect validation and logs protect authentication material. |
| Conversations | An authenticated user can create, list, reopen, and continue owned conversations; another user cannot access them. |
| Persisted messages | Prompts, responses, run outcomes, selections, and the active branch survive refresh and application restart. |
| Streaming | Events are isolated by run; completion, failure, cancellation, reconnect, and replay do not duplicate or mix responses. Streams survive the supported deployment topology. |
| OpenAI | A configured, registry-approved OpenAI model completes a real request through NestJS and FastAPI with normalized content, usage, errors, and limits. |
| Anthropic | A configured, registry-approved Anthropic model passes the same live execution and accounting checks, including initial input-token usage. |
| Gemini | A configured, registry-approved Gemini model passes the same checks, including enforced output limits and correct usage mapping. |
| Economy mode | The browser's selected mode reaches the router and applies the documented eligible-model cost policy, including zero-cost handling. |
| Smart mode | The selected mode applies a deterministic, explainable quality/cost/latency policy using versioned registry inputs. |
| Max mode | The selected mode applies the documented quality-first policy while preserving capability, health, budget, and credit constraints. |
| Compare 3 | One prompt creates one turn and three distinct eligible model runs; they stream and terminate independently. Selecting a response persists the branch used by the next turn. |
| Try Another AI | A distinct eligible alternative runs for the same turn; previous candidates remain available and excluded from future history unless selected. |
| Automatic provider fallback | An approved eligible fallback executes after a qualifying failure with bounded attempts, visible run identity, preserved context, and correct credit reconciliation. |
| Provider-neutral context | Only the selected branch, authorized workspace material, instructions, and valid summaries enter the canonical context in chronological order within model budgets. |
| Frozen context snapshots | Persist the immutable canonical input and provenance before execution. All alternatives/comparison candidates for that prompt reuse the same snapshot; later memory edits or uploads cannot silently change it. Provider conversion must preserve its meaning and content within prevalidated limits. |
| Usage credits | Grants, reserve-before-call, actual usage settlement, release/refund, cancellation, retries, and recovery are auditable and idempotent. Concurrent requests cannot overspend. No real-money purchase flow is required. |
| Workspace memory | Authorized TXT/Markdown/PDF content is parsed, chunked, embedded, retrieved, and supplied as relevant context. Processing status, failure recovery, deletion/retention, and workspace isolation work. |
| TXT workspace files | Validate and store private objects in S3; extract text and show usable processing results. |
| Markdown workspace files | Support Markdown MIME/extension variations, safely extract text, store private objects, and retrieve permitted content. |
| PDF workspace files | Extract supported text-based PDFs with bounded processing. Explain unsupported, encrypted, malformed, or scanned/image-only documents; OCR is outside release scope. |

Compare 3 is a product requirement, not a renamed single-response view. Economy,
Smart, and Max must affect execution, not just presentation. A snapshot identifier
or hash without recoverable frozen content does not satisfy snapshot acceptance.
Production embeddings must demonstrate useful retrieval; deterministic local
hash vectors alone do not establish semantic quality.

## Explicitly outside the initial public release

- Teams and collaborative team workspaces.
- Enterprise SSO.
- Kubernetes.
- Paid subscriptions.
- Real-money credit purchases.
- OCR.
- Image understanding.
- Advanced evaluation dashboards.

Individual workspace ownership, Google login, usage limits, operational
monitoring, basic routing explanations, and retrieval quality checks remain
required. Existing subscription/entitlement tables do not expand release scope.

## Release evidence required

Release readiness requires evidence tied to the release commit: clean-checkout
CI; isolated database integration tests; migration rehearsal; production builds
and container checks; browser acceptance on staging; bounded live tests for all
three providers; authorization and accounting failure tests; and deployment,
backup/restore, alert, and rollback evidence for the fixed architecture.

All required features must satisfy their acceptance criteria and all P0 blockers
must close. Repository files, passing unit tests, or a successful Vercel
deployment record by themselves are insufficient. No timeline or completion
percentage is inferred from previous phase names.

## Open Questions

The hosting stack, required features, frozen snapshots, and excluded features are
settled. Remaining decisions are:

- What production/staging domains and cookie arrangement will connect Vercel,
  Google callbacks, and the API? What AWS region and data residency apply?
- Which IaC tool, image registry configuration, internal service-authentication
  mechanism, deployment environments, and approvers will be used?
- Which initial model versions, capabilities, prices, mode weights, and Compare 3
  selection policy apply? Must the three candidates span three providers?
- What free credit grant, conversion, partial-output/cancellation charging, and
  fallback reservation policies apply? No payment product is implied.
- What TXT/Markdown/PDF size/page limits, processing limits, retention/deletion
  rules, and unsupported-PDF experience apply?
- Which production embedding implementation, retrieval thresholds, context
  budgets, and summary refresh policy will be validated? How should an
  alternative be handled if its model cannot fit the frozen snapshot?
- What load targets, browser/device matrix, recovery objectives, alert ownership,
  and support responsibilities define the public-release acceptance run?
