# 0007. Separate SPA and REST API

- **Status:** Accepted
- **Date:** 2026-10-28

## Context

A goal of the project is to learn deployable system boundaries: a stateless API, a static
frontend, and a database.

## Options considered

1. **Next.js full stack**: SSR, one deployable, very productive. The boundary between client and
   server is blurred, and the best hosting is tied to Vercel.
2. **React SPA (Vite) plus Express**: Express is ubiquitous but slower, has weaker typing, and
   handles async errors poorly.
3. **React SPA (Vite) plus Fastify**: a fast, schema-friendly, well-typed API framework, with
   `inject()` for tests that don't open a network port.
4. **React SPA plus Hono**: tiny and runs at the edge, with a smaller ecosystem for Node
   plugins.

## Decision

A Vite + React SPA calling a Fastify REST API, served same-origin under `/api`.

## Consequences

- The frontend can be served as static files from a CDN. The API scales horizontally on its
  own.
- No SSR or SEO, which this app (an authenticated dashboard) doesn't need.
