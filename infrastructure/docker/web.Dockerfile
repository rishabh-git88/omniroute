FROM node:24.20.0-bookworm-slim AS build

ARG NEXT_PUBLIC_API_URL
ARG RENDER_API_ORIGIN
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV RENDER_API_ORIGIN=$RENDER_API_ORIGIN
ENV NEXT_TELEMETRY_DISABLED=1
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable
RUN pnpm config set store-dir /pnpm/store
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json eslint.config.mjs ./
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN --mount=type=cache,id=omniroute-pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile --network-concurrency=8 --fetch-timeout=120000

COPY apps/web apps/web
COPY packages/config packages/config
COPY packages/types packages/types
COPY packages/ui packages/ui

RUN test -n "$NEXT_PUBLIC_API_URL" \
  && test -n "$RENDER_API_ORIGIN" \
  && pnpm --filter @omniroute/web... build

FROM node:24.20.0-bookworm-slim AS runtime

ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
WORKDIR /app

RUN groupadd --system --gid 1001 omniroute \
  && useradd --system --uid 1001 --gid omniroute omniroute

COPY --from=build --chown=omniroute:omniroute /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=omniroute:omniroute /workspace/apps/web/.next/static ./apps/web/.next/static

USER omniroute
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
