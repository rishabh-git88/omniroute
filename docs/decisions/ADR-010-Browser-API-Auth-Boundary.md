# ADR-010: Production Browser, API, and Authentication Boundary

- Status: Superseded by [[ADR-015-Vercel-Same-Origin-API-Proxy]]
- Date: 2026-09-10
- Scope: Release Milestone 1, as explicitly authorized by the user.

## Context

The audit reproduced dynamic Next.js environment lookup falling back to a local
API in production, blocked public rendering during session checks, conflated
outage/logged-out states, CORS/SSE header loss, a return-path open redirect, and
OAuth query values in normal request logs. The release now uses a Vercel frontend
at `https://app.<domain>` and a NestJS API at `https://api.<domain>` on a shared
registrable domain.

## Decision

- Read `process.env.NEXT_PUBLIC_API_URL` and `process.env.NODE_ENV` directly in
  the web module so Next.js can replace them statically. The configured public
  origin is fixed into the build for browser and server rendering; changing it
  requires rebuilding. Do not use a separate runtime API-origin override.
- Validate origin-only HTTP(S) URLs. Only explicit development/test mode can
  default to `http://localhost:4000`. Production requires an explicit HTTPS DNS
  origin and rejects localhost, local hostnames, and IP literals. Unknown mode
  with no URL also fails closed. Report invalid keys without configured values.
- Render the public landing content immediately while checking the session in
  the background. Bound `/auth/me` by eight seconds. Only HTTP 401 means
  anonymous; network failure, timeout, other HTTP errors, or malformed successful
  session responses produce a separate unavailable state with retry UI.
- Require configured production sibling origins and their explicit shared
  `AUTH_COOKIE_DOMAIN`. Session cookies use that domain with HttpOnly, Secure,
  SameSite=Lax, and Path=/. Temporary OAuth cookies remain API-host-only on the
  callback path. Clearing cookies uses matching scope. The operator must own the
  registrable domain and trust its subdomains; do not use a public suffix or a
  shared hosting provider's domain.
- Retain exact frontend-origin CSRF checks and session-bound CSRF tokens. Permit
  content-type, x-csrf-token, idempotency-key, and last-event-id through CORS, with
  credentials and an exact configured origin. Expose x-request-id.
- Send SSE through Fastify's supported stream response lifecycle so CORS and
  cookie serialization hooks run. Keep the existing run/replay semantics until
  the separate streaming milestone.
- Accept only local return paths without backslashes or control/space characters;
  resolve them against the configured web origin and verify the resulting origin
  at both OAuth start and callback.
- Serialize normal request logs with method and query-free path, excluding
  credential headers. The OAuth callback logs a generic failure message only.
- Reuse the existing green O mark and dark rounded tile as a self-contained SVG
  application icon. Serve legacy favicon requests through a redirect to that
  icon; no external assets or runtime image generation are needed.

## Consequences

The web build cannot silently adapt to a different API at runtime. Public content
remains available during API outage, but authenticated workspace operations wait
for session recovery. Same-site sibling domains permit credentialed requests;
CORS/CSRF protections still apply because the origins differ. Shared session
cookie scope requires all sibling hosts to be trusted. Public Vercel preview
domains cannot substitute for the production shared-domain setup.

Normal API request logs omit all query strings, trading query-level diagnostics
for protection of OAuth material. Infrastructure access logging must separately
avoid capturing callback query secrets before public deployment.

## Verification

Regression suites cover URL validation, landing/login rendering, bounded session
failure/retry, return-path attacks, Google callback derivation, real Fastify
preflights/SSE headers/cookies/logging, and branding routes. The production smoke
script starts a configured build and a fresh Chromium instance, intercepts
session requests, and verifies the compiled browser origin and outage UI. Live
Google/session-database/deployed-domain acceptance remains a separate gate.

## Related notes

[[ADR-006-MVP-Authentication]] · [[Authentication]] · [[Frontend]] ·
[[Deployment]] · [[CURRENT-STATE]] · [[RELEASE-BLOCKERS]]

## Open Questions

- Which owned domain, Google OAuth client, and deployment environment will supply
  the configured topology for live authentication acceptance?
- Which infrastructure access-log policy will prevent OAuth callback query
  capture at ingress while retaining operational diagnostics?
