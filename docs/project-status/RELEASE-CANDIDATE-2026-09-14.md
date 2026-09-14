# Release Candidate Assessment — 2026-09-14

## Verdict

**NOT READY.** The source fixes below address the two reported CI defects, but
the required GitHub, deployment-SHA, authenticated production, Redis, provider,
Storage, embedding/RAG, recovery, and dependency-audit evidence has not yet
been obtained. A blocked check is not a pass.

## Candidate evidence

- Source revision inspected: `d40d57c` (`fix(deploy): correct Supabase Storage blueprint config`).
- Production health and readiness: reported manually verified HTTP 200 at
  `https://oneroute-ai.vercel.app/v1/health` and `/v1/health/ready`.
  This assessment's independent HTTPS probe was blocked by this environment's
  network timeout, so it does not add fresh external evidence.
- Browser CI now installs Python and `uv`, synchronizes the locked router
  environment, then intentionally runs the full `pnpm build`; it does not skip
  the AI-router artifact.
- The execution integration fixture now creates an isolated user/workspace/session
  and clears only its injected non-production coordination backend before each
  case. Production limits, Redis behavior, and rate-limit thresholds are unchanged.
- The formerly inconclusive `P2025` was traced to concurrent integration files
  sharing the same disposable database: fixture suites issue `TRUNCATE ...
  CASCADE` while provider execution performs reservation cleanup. The integration
  runner is configured for one fork so those destructive fixture resets cannot
  race an in-flight `RequestGroup` update. Fixture provider-model IDs are also
  unique per run, allowing deterministic reruns.
- Local checks passed: `pnpm lint`; `pnpm typecheck`; `pnpm test` (including
  Python `162 passed`, with two FastAPI deprecation warnings); `git diff --check`.
- The guarded local database runner applied five migrations and validated migration
  status and Prisma drift. This environment did not return a complete integration
  runner summary or explicit process status after the serialization correction;
  therefore database integration acceptance remains NOT READY pending a clean
  runner result.

## Production gates

| Area | Status | Required evidence |
| --- | --- | --- |
| GitHub CI and deployed SHAs | NOT READY | Green run for this revision; Vercel/API/router deployed SHA confirmation. |
| Google OAuth | NOT READY | Controlled real-user login, refresh, logout, and post-logout rejection. |
| Redis | NOT READY | Render Key Value connectivity, TTLs, outage/recovery, and fail-closed write evidence. |
| Groq | NOT READY | Groq v2 candidate contains reviewed scores but production registry activation and end-to-end smoke are unverified. |
| Gemini / OpenRouter | NOT READY | Resume strict calibration and review immutable v2 evidence; do not activate early. |
| Compare 3 | NOT READY | Requires three configured, reviewed, enabled, healthy eligible models. |
| Supabase Storage | NOT READY | Verify private bucket and controlled TXT/Markdown/PDF lifecycle without URLs. |
| Embeddings / RAG | NOT READY | Production remains deliberately `EMBEDDING_PROVIDER=disabled`; approve an adapter/model and migration plan first. |
| Credits / observability / recovery | NOT READY | Controlled test-user settlement and non-destructive failure/recovery evidence. |
| Security | NOT READY | Static controls are present; deployed bundle, cookies, logs, CORS, and dependency audit need current evidence. |

## Exact external actions

1. GitHub: open **Actions → CI → latest run for the candidate SHA**; confirm every job is green and record the run URL.
2. Google Cloud Console: **APIs & Services → Credentials → production OAuth 2.0 Client ID → Authorized redirect URIs**; add/confirm exactly `https://oneroute-ai.vercel.app/v1/auth/google/callback`, then save. Do not add the Render hostname.
3. Render: for `omniroute-api`, confirm the required server-only variables are present (without exposing values), `AUTH_COOKIE_DOMAIN` is unset, and the deployed SHA matches the candidate. For `omniroute-ai-router`, confirm the same internal token reference and only intended adapter flags/keys.
4. Supabase: **Storage → bucket → Configuration**; confirm the configured bucket is private, then use a controlled workspace/test user for file acceptance.
5. From a trusted operator machine only, run the documented resumable Gemini/OpenRouter calibration commands in `docs/devops/Render.md`; review reports and create successor immutable registry entries before any activation.
