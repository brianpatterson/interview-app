# syntax=docker/dockerfile:1
# Build context: repository root.  docker build -f apps/api/Dockerfile .

FROM node:26-slim AS build
WORKDIR /repo
RUN npm install --global pnpm@12.16.1
# Manifests first, so the dependency layer is cached until a package.json or the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @interview-app/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @interview-app/api build

# Runtime: just Node, the bundle and the SQL migrations. No package manager, no node_modules.
FROM node:26-slim
ENV NODE_ENV=production \
    MIGRATIONS_FOLDER=/app/drizzle
WORKDIR /app
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/drizzle ./drizzle
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/index.js"]
