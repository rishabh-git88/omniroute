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
[[ADR-006-MVP-Authentication]]

## Open Questions

- Which production parent domain and reverse-proxy topology will own the shared
  cookie boundary?
