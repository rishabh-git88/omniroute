FROM node:24.20.0-bookworm-slim AS build

ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/v1
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_TELEMETRY_DISABLED=1
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json eslint.config.mjs ./
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN pnpm install --frozen-lockfile

COPY apps/web apps/web
COPY packages/config packages/config
COPY packages/types packages/types
COPY packages/ui packages/ui

RUN pnpm --filter @omniroute/web... build

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
CMD ["node", "apps/web/server.js"]
