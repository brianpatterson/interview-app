# syntax=docker/dockerfile:1
# Build context: repository root.  docker build -f apps/web/Dockerfile .
# The image is Caddy itself: it serves the built SPA, terminates TLS and proxies /api to the API.

FROM node:26-slim AS build
WORKDIR /repo
RUN npm install --global pnpm@12.16.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/contract/package.json packages/contract/
RUN pnpm install --frozen-lockfile --filter @roundtable/web...
COPY tsconfig.base.json ./
COPY packages/contract packages/contract
COPY apps/web apps/web
RUN pnpm --filter @roundtable/web build

FROM caddy:2.11-alpine
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
