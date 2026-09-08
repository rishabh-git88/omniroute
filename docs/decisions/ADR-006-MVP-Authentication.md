# ADR-006: MVP Authentication and Session Ownership

- Status: Accepted
- Date: 2026-09-07
- Source: `references/architecture-source.txt`, sections 4.2, 12, and 14.1

## Context

The MVP requires Google login. The architecture assigns users, OAuth identities,
sessions, roles, and deletion to the NestJS Identity module and requires durable
sessions in PostgreSQL, but leaves the exact endpoints and session ownership
open.

## Decision

- Treat Google as an identity adapter behind the provider-neutral `accounts`
  relation; never use the Google subject as the OmniRoute user ID.
- Run authorization-code flow with S256 PKCE, state, and nonce in NestJS. Verify
  the ID token against Google's keys, issuer, audience, nonce, and verified email.
- Store only a keyed hash of an opaque session token in PostgreSQL. Use a
  short-lived, rotating, revocable HttpOnly cookie rather than browser-visible
  bearer tokens or a stateless JWT.
- Make NestJS guards deny by default. Protect unsafe cookie-authenticated commands
  with an exact allowed-origin check and session-bound CSRF proof.
- Let Next.js Proxy perform only an optimistic cookie presence redirect; every
  data access remains authorized by NestJS and its repositories.

## Consequences

Session revocation is immediate and identity remains independent of Google, at
the cost of one indexed PostgreSQL lookup for authenticated requests. Production
deployment must provide HTTPS, server-only OAuth/session secrets, and a cookie
domain or same-origin proxy topology that also permits Next.js's optimistic check.

## Related notes

[[Authentication]] · [[Security]] · [[Backend]] · [[PostgreSQL-Schema]]

## Open Questions

- Will production use sibling subdomains with a shared cookie domain or a
  same-origin reverse proxy?
