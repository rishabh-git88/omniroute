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
WORKDIR /app

RUN groupadd --system --gid 1001 omniroute \
  && useradd --system --uid 1001 --gid omniroute omniroute

COPY --from=build --chown=omniroute:omniroute /opt/omniroute-api ./

USER omniroute
EXPOSE 4000
CMD ["node", "dist/main.js"]
