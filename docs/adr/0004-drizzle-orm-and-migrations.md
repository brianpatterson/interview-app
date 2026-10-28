# 0004. Drizzle ORM with checked-in SQL migrations

- **Status:** Accepted
- **Date:** 2026-10-28

## Context

We need type-safe queries and a reviewable, repeatable way to evolve the schema.

## Options considered

1. **Raw SQL with `pg`**: maximum control, but no type safety on results, and migrations are
   hand-rolled.
2. **Prisma**: mature, with its own schema language and client. It hides SQL and has a heavier
   runtime and generation step.
3. **Kysely**: an excellent type-safe query builder, but no schema definition or migration
   generation built in.
4. **Drizzle**: the schema is defined in TS, queries read like SQL, `drizzle-kit` generates plain
   `.sql` migration files, and the runtime is thin.

## Decision

Drizzle ORM. `apps/api/src/db/schema.ts` is the source of truth. `pnpm db:generate` writes SQL
migrations to `apps/api/drizzle/`, and they are committed and reviewed. `pnpm db:migrate`
applies them, and production will run that same step on deploy.

## Consequences

- Migrations are plain SQL, so they're easy to review and to explain.
- CI regenerates migrations and fails if the schema changed without a migration (drift check).
- Drizzle is still pre-1.0, so expect some API churn on upgrades.
