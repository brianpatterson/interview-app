# 0002. TypeScript monorepo with pnpm workspaces

- **Status:** Accepted
- **Date:** 2026-10-28

## Context

There is a frontend and a backend, and they must agree on request and response shapes. One
developer, with AI agents doing much of the work.

## Options considered

1. **Polyrepo** (separate web and api repos): independent deploys, but the shared types would
   have to be published as a package, and a cross-cutting change means coordinated PRs.
2. **Single Next.js app**: one deployable, with server actions instead of an explicit API. Less
   to learn about HTTP API design, and the frontend is coupled to one framework's server.
3. **Monorepo with pnpm workspaces**: `apps/web`, `apps/api`, `packages/shared`. One PR can
   change both sides atomically.
4. **Monorepo with Nx or Turborepo**: adds task caching and dependency graphs. Overkill for
   three packages.

## Decision

pnpm workspaces monorepo, TypeScript end to end, with no build orchestrator yet.

## Consequences

- The shared package is consumed as TypeScript source (`exports: ./src/index.ts`), so there's no
  build step. That works because Vite and tsx both compile TS. The production API build will
  need to bundle it (revisit when we deploy).
- Add Turborepo if CI time becomes a problem.
