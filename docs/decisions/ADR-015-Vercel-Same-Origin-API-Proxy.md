# ADR-015: Vercel same-origin API proxy

- Status: Accepted
- Date: 2026-09-12

## Context

Production uses `https://oneroute-ai.vercel.app` for the Next.js frontend and a
Render-hosted NestJS API. There is no owned shared parent domain for sibling
browser/API hosts. Direct browser requests to Render would require cross-site
cookies and widen the browser-facing authentication boundary.

## Decision

Vercel remains the browser's only public origin. `NEXT_PUBLIC_API_URL` is
`https://oneroute-ai.vercel.app`; the application appends `/v1`. Next.js rewrites
`/v1` and `/v1/:path*` to the server-only `RENDER_API_ORIGIN`, which must be an
HTTPS origin without a path or `/v1` suffix.

The API receives `WEB_APP_URL`, `CORS_ORIGIN`, and `API_PUBLIC_URL` set to the
same Vercel origin. `AUTH_COOKIE_DOMAIN` is unset, so session cookies are
host-only, HttpOnly, Secure, SameSite=Lax, and `Path=/`. CSRF remains exact-origin
plus session-bound-token validation. OAuth transaction cookies remain host-only,
HttpOnly, Secure, SameSite=Lax, and restricted to the Google callback path.

Production also continues to support an owned sibling-domain topology only when
`WEB_APP_URL=https://app.<domain>`, `API_PUBLIC_URL=https://api.<domain>`, and
`AUTH_COOKIE_DOMAIN=<domain>` all agree.

## Consequences

Google's authorized callback is
`https://oneroute-ai.vercel.app/v1/auth/google/callback`; Vercel proxies it to
Render. Browser API traffic never targets the Render hostname, though Render
continues to bind and health-check its own service URL.

Vercel must hold the non-public `RENDER_API_ORIGIN` at build/deploy time. A
misconfigured or unavailable rewrite fails browser API requests without changing
the API's CSRF, cookie, or database controls.

## Related notes

[[ADR-010-Browser-API-Auth-Boundary]] · [[Authentication]] · [[Deployment]] ·
[[Render]]
