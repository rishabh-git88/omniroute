FROM node:24.20.0-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json eslint.config.mjs ./
COPY apps/api/package.json apps/api/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/provider-contracts/package.json packages/provider-contracts/package.json
COPY packages/types/package.json packages/types/package.json

RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY packages/config packages/config
COPY packages/provider-contracts packages/provider-contracts
COPY packages/types packages/types

RUN pnpm --filter @omniroute/api... build
RUN pnpm --filter @omniroute/api deploy --prod /opt/omniroute-api

FROM node:24.20.0-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV NODE_OPTIONS=--enable-source-maps
WORKDIR /app

RUN groupadd --system --gid 1001 omniroute \
  && useradd --system --uid 1001 --gid omniroute omniroute

COPY --from=build --chown=omniroute:omniroute /opt/omniroute-api ./

USER omniroute
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://localhost:4000/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
