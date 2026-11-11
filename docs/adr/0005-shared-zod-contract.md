# 0005. Shared Zod schemas as the API contract

- **Status:** Superseded by [ADR-0022](0022-effect-for-the-api.md)
- **Date:** 2026-10-28

## Context

The API must validate untrusted input at runtime, and the web app needs the same shapes as
compile-time types. Defining them twice invites drift.

## Options considered

1. **Hand-written TS interfaces plus ad hoc validation**: two sources of truth.
2. **OpenAPI spec with codegen**: language-agnostic and good for public APIs, but adds tooling
   and a generation step.
3. **tRPC**: end-to-end types without a REST surface, but it couples clients to TS and hides
   HTTP design.
4. **Zod schemas in `packages/shared`**: one definition gives both the runtime validator and the
   inferred static type.

## Decision

Zod schemas in `packages/shared`. The API validates with `safeParse`, and the web app imports
the inferred types.

## Consequences

- Changing the contract is a single edit, and the compiler shows every caller that breaks.
- If third parties ever consume the API, generate OpenAPI from these schemas.
