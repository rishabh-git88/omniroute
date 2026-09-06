# OmniRoute Documentation Bootstrap

You are working inside the OmniRoute project.

The source-of-truth architecture is:

references/architecture-source.txt

The original PDF is:

references/OmniRoute_Product_Architecture_and_Workflows.pdf

Read architecture-source.txt completely before making architectural
decisions.

Your task is to transform this architecture into an Obsidian-compatible
engineering knowledge graph that is also optimized for Codex CLI.

## Primary objective

Create structured, interconnected Markdown documentation instead of one
large architecture document.

The documentation must work simultaneously as:

1. Human-readable software architecture
2. Obsidian knowledge graph
3. Codex project context
4. Engineering documentation
5. Architecture decision history

## Create this structure

docs/
├── 00-OmniRoute-Hub.md
├── product/
│   ├── Product-Vision.md
│   ├── User-Flows.md
│   └── MVP-Scope.md
├── architecture/
│   ├── System-Architecture.md
│   ├── Frontend.md
│   ├── Backend.md
│   ├── AI-Router.md
│   ├── Provider-Layer.md
│   ├── Model-Registry.md
│   ├── Context-Memory.md
│   ├── Evaluation-Engine.md
│   └── Credits-Billing.md
├── data/
│   ├── PostgreSQL-Schema.md
│   ├── Redis.md
│   └── Vector-Memory.md
├── engineering/
│   ├── API-Design.md
│   ├── Security.md
│   ├── Testing.md
│   └── Observability.md
├── devops/
│   ├── Docker.md
│   ├── CI-CD.md
│   └── Deployment.md
├── decisions/
│   ├── ADR-001-Monorepo.md
│   ├── ADR-002-PostgreSQL.md
│   └── ADR-003-AI-Router.md
└── roadmap/
    ├── Roadmap.md
    └── Current-Sprint.md

## Obsidian requirements

Use Obsidian wiki links extensively.

For example:

[[System-Architecture]]
[[AI-Router]]
[[Provider-Layer]]
[[Context-Memory]]
[[PostgreSQL-Schema]]
[[Redis]]
[[Evaluation-Engine]]

Every important concept should connect to related concepts.

Avoid isolated notes.

The knowledge graph should have:

00-OmniRoute-Hub
    -> Product
    -> Architecture
    -> Data
    -> Engineering
    -> DevOps
    -> Roadmap
    -> ADRs

System-Architecture
    -> Frontend
    -> Backend
    -> AI-Router
    -> Context-Memory
    -> Database
    -> Deployment

AI-Router
    -> Model-Registry
    -> Provider-Layer
    -> Context-Memory
    -> Evaluation-Engine
    -> Credits-Billing
    -> Redis

Provider-Layer
    -> OpenAI
    -> Anthropic
    -> Gemini
    -> Model-Registry

Context-Memory
    -> PostgreSQL-Schema
    -> Vector-Memory
    -> Redis

## Each architecture document

Where applicable include:

- Purpose
- Responsibilities
- Inputs
- Outputs
- Dependencies
- Data used
- Failure behavior
- Security considerations
- Scalability considerations
- Related notes
- Implementation notes

Keep files focused.

Do not create giant Markdown documents.

## Mermaid

Use Mermaid diagrams extensively.

System-Architecture.md should contain an overall system diagram.

AI-Router.md should contain the complete routing flow.

Context-Memory.md should contain the context assembly flow.

Credits-Billing.md should contain the credit reserve/settle/refund flow.

Deployment.md should contain the infrastructure/deployment flow.

API-Design.md should contain request flow diagrams where useful.

## Tags

Use useful Obsidian tags such as:

#architecture
#ai
#backend
#frontend
#database
#devops
#product
#security
#decision
#roadmap

Do not over-tag documents.

## AGENTS.md

Create a concise AGENTS.md at repository root.

It should explain:

- what OmniRoute is
- that docs/00-OmniRoute-Hub.md is the documentation entry point
- architecture rules
- important documentation locations
- how Codex should retrieve context
- how architectural changes are documented

Important rules:

1. Read AGENTS.md first.
2. Read docs/00-OmniRoute-Hub.md when architecture context is needed.
3. Follow wiki links only to documentation relevant to the current task.
4. Do not couple business logic directly to AI providers.
5. AI provider calls must use the Provider Layer.
6. Automatic selection must use the AI Router.
7. Conversation context must remain provider-neutral.
8. PostgreSQL is the primary system of record.
9. Redis is for ephemeral, cached and realtime state.
10. Provider/model capabilities must not be scattered as hardcoded logic.
11. Significant architectural changes require an ADR.
12. Update relevant documentation whenever implementation changes architecture.

## Roadmap

Generate the implementation roadmap from the source architecture.

Do not invent requirements that contradict the architecture source.

Current-Sprint.md should initially focus only on project foundation.

## Accuracy

The source architecture document is authoritative.

Do not silently invent missing decisions.

If something important is ambiguous, document it under:

## Open Questions

instead of guessing.

## Final validation

After creating everything:

1. Check all wiki links.
2. Check Markdown structure.
3. Check Mermaid syntax.
4. Check for isolated architecture notes.
5. Check AGENTS.md.
6. Print the resulting directory tree.
7. Summarize the primary knowledge graph.
