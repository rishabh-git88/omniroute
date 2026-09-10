# Authentication

#architecture #security #identity

## Purpose

Authenticate the MVP with Google while keeping OmniRoute identity and sessions
provider-neutral. NestJS owns OAuth verification and PostgreSQL session state;
Next.js owns presentation and optimistic navigation only.

## Contract

| Method | Endpoint | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/v1/auth/google` | public | create state, nonce, and PKCE transaction |
| `GET` | `/v1/auth/google/callback` | public | verify Google identity and create session |
| `GET` | `/v1/auth/me` | authenticated | current user, workspace, and CSRF proof |
| `POST` | `/v1/auth/logout` | authenticated + CSRF | revoke the durable session |

Google is an identity adapter. The domain persists a normalized `users` row and
an `accounts(identity_provider, provider_account_id)` row, so another identity
provider can be introduced without changing session or authorization code.

## Session and request security

- The browser receives a random 256-bit opaque token in an HttpOnly, SameSite=Lax
  cookie. `Secure` is required automatically in production.
- PostgreSQL stores only an HMAC-SHA-256 token hash. Sessions have an absolute
  24-hour default lifetime, rotate after 15 minutes of activity, and can be
  revoked immediately.
- OAuth transactions use state, nonce, and S256 PKCE values in short-lived
  HttpOnly cookies. Google access and ID tokens are verified transiently and are
  never persisted.
- Unsafe authenticated requests require both the configured web origin and an
  `X-CSRF-Token` derived from the server-only session secret and durable session
  ID.
- NestJS authentication and CSRF guards are global. Public routes must opt out
  explicitly with `@Public()`; Next.js Proxy performs only an optimistic cookie
  presence check.
- Login and logout write audit events without OAuth tokens or session material.

## Local setup

Copy `.env.example` to the ignored `.env`, add Google OAuth web credentials, and
generate `AUTH_SESSION_SECRET` with `openssl rand -base64 48`. Configure this
authorized redirect URI in Google Cloud:

`http://localhost:4000/v1/auth/google/callback`

Start PostgreSQL, then run `pnpm dev`. Open `http://localhost:3000/login`.

## Related notes

[[Frontend]] · [[Backend]] · [[Security]] · [[PostgreSQL-Schema]] ·
[[ADR-006-MVP-Authentication]] · [[ADR-010-Browser-API-Auth-Boundary]]

## Production sibling-domain configuration

Use an owned shared registrable domain with the following mapping. Angle-bracket
placeholders describe configuration and must be replaced; no domain is built in.

| Setting | Value |
| --- | --- |
| Vercel build `NEXT_PUBLIC_API_URL` | `https://api.<domain>` |
| NestJS `API_PUBLIC_URL` | `https://api.<domain>` |
| NestJS `WEB_APP_URL` and `CORS_ORIGIN` | `https://app.<domain>` |
| NestJS `AUTH_COOKIE_DOMAIN` | `<domain>`; a leading dot is normalized away |
| Google authorized callback | `https://api.<domain>/v1/auth/google/callback` |

Production startup rejects missing/mismatched cookie domains and sibling hosts,
non-HTTPS/local origins, and origins with paths, queries, or credentials. Session
cookies span the configured domain. OAuth state/nonce/PKCE/return-path cookies
remain API-host-only, expire after ten minutes, and use the callback path. Both
use HttpOnly, Secure, and SameSite=Lax in production; clear operations preserve
the same scope. Subdomains receiving the shared session cookie must be trusted.

The browser includes credentials and sends the existing session-bound CSRF token
on mutations. API CORS permits content-type, x-csrf-token, idempotency-key, and
last-event-id for the exact configured web origin. Fastify sends SSE using its
normal stream lifecycle, preserving CORS and rotated session cookies.

Only `/auth/me` HTTP 401 means logged out. An eight-second timeout, network
outage, other HTTP failure, or invalid response produces retryable unavailable
UI without claiming that the durable session ended. Landing content renders
before that check completes. OAuth return paths are checked at start and
callback; normal request logs omit query strings and credential headers.

## Open Questions

- Which owned parent domain and Google OAuth client will be used for live
  acceptance? The sibling-domain topology is settled by ADR-010.
