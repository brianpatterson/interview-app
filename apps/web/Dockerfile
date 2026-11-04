# syntax=docker/dockerfile:1
# Build context: repository root.  docker build -f apps/web/Dockerfile .
# The image is Caddy itself: it serves the built SPA, terminates TLS and proxies /api to the API.

FROM node:26-slim AS build
WORKDIR /repo
RUN npm install --global pnpm@12.16.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @interview-app/web...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @interview-app/web build

FROM caddy:2.10-alpine
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
