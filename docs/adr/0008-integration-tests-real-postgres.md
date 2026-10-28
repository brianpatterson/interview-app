# 0008. Integration tests against a real Postgres

- **Status:** Accepted
- **Date:** 2026-10-28

## Context

Most of the API's logic sits at the database boundary: constraints, enums, defaults, ordering.
Mocks would test our assumptions, not the real behavior.

## Options considered

1. **Unit tests with a mocked DB**: fast, but misses the bugs that matter here.
2. **pg-mem or another in-memory fake**: fast, but not real Postgres semantics.
3. **Testcontainers**: a fresh Postgres per test run. Fully isolated, with slower startup.
4. **A dedicated `app_test` database** on the dev Postgres, and a Postgres service container in
   CI.

## Decision

Option 4. Vitest runs the real migrations against `app_test`, truncates between tests, and calls
the API through `fastify.inject()` with no network.

## Consequences

- Tests require `pnpm db:up` locally.
- Tests in a file run serially, sharing one database. Move to a schema per worker or to
  Testcontainers if parallelism becomes necessary.
