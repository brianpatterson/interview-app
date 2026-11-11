# 0022. Build the API on Effect 4: HttpApi, an Effect Schema contract and Drizzle 1.0

- **Status:** Accepted
- **Date:** 2026-11-11
- **Supersedes:** [ADR-0005](0005-shared-zod-contract.md) (Zod contract),
  [ADR-0007](0007-separate-spa-and-rest-api.md) (Fastify; the SPA + same-origin REST API part
  carries over) and [ADR-0008](0008-integration-tests-real-postgres.md) (`fastify.inject()`;
  testing against a real Postgres carries over)

## Context

Roundtable is a learning project, and [Effect](https://effect.website) is one of the things to
learn: typed errors, services and layers, structured concurrency, and schema-first APIs. Most
code here is written by agents, and the goal is a software factory: production errors become
PRs without a human starting the investigation. That favours a stack where failures are typed
values with enough context to reproduce them.

Today the API is Fastify + Drizzle 0.45 + Better Auth, with Zod schemas in `packages/shared` as
the contract. A spike (2026-11-10/11, [findings](../research/2026-11-effect-spike.md)) built the
Effect version of a slice of it against the real database: health, applications
list/create/update, the Better Auth mount, session middleware, a typed client, Sentry reporting,
and two database layers. It checked each claim with a test rather than from the docs, and
corrected three of them along the way.

## Options considered

1. **Keep Fastify and use Effect inside it** (services, email). Small change. Cons: every route
   is a Promise/Effect boundary, errors are untyped at the HTTP edge, and no shared contract or
   typed client comes out of it.
2. **Effect `HttpApi`, Drizzle 0.45 behind a hand-written bridge.** Stable Drizzle. Cons: the
   spike's bridge **leaked a pooled connection, holding an open transaction**, when a request
   was cancelled. Effect's HTTP server cancels handlers when clients disconnect, so this would
   exhaust the pool. A corrected bridge is possible, but it's subtle transaction code we'd own.
3. **Effect `HttpApi` and Drizzle 1.0's native Effect support.** Queries and transactions are
   Effects, and cancellation rolls back (tested). Cons: Drizzle 1.0 is a release candidate.
4. **All Effect, with `@effect/sql-pg` and our own Better Auth adapter**, giving one connection
   pool. Cons: hand-written SQL, no `drizzle-kit` migrations, and we'd own the database layer of
   authentication and miss the fixes Better Auth ships for its adapter.

## Decision

Option 3:

- **HTTP:** Effect 4 `HttpApi` replaces Fastify. Every module in `effect/http-api`, and
  `HttpRouter`, is labelled `@stability unstable`, so `effect` and `@effect/*` are pinned to
  **exact** versions and upgraded together. An upgrade PR may need code changes.
- **Contract:** the `HttpApi` definition, written with Effect Schema, lives in `packages/shared`
  and replaces the Zod schemas. It has no server code in it. Requests are validated by the
  endpoint schemas before handlers run, and responses are encoded through theirs, so columns not
  in the schema (like `userId`) never leave the server.
- **Web:** the app uses the typed client generated from that definition, inside TanStack Query.
  This costs about 46 KB gzipped (113 → ~159 KB). One schema system covers the whole contract,
  and errors arrive typed (`ApplicationNotFound`, `Unauthorized`).
- **Database:** Drizzle 1.0 (exact pin, `1.0.0-rc.5` at the time of writing) through
  `drizzle-orm/effect-postgres`, on `@effect/sql-pg`. **`paramsInErrors` is on**, so failed queries
  carry their values inside the process, and the redaction from #29 reduces them to kinds
  (`params: <redacted: uuid, string(32), null>`) before anything is logged or sent. Agents
  debugging a Sentry issue get the kind of every value and never the value itself.
- **Leak tests are a required gate.** The outage tests from #29 (database taken away mid-session;
  the token must appear nowhere in Sentry events or log lines) move to the Effect server. Any
  change that adds a logger, an error reporter or an outgoing integration extends them.
- **Auth:** Better Auth stays, mounted as a plain route (`HttpEffect.fromWebHandler`). Session
  lookup is `HttpApi` middleware that provides a `CurrentUser` service. Better Auth's adapter
  keeps an ordinary Promise-based Drizzle instance, so there are **two small connection pools**:
  `@effect/sql-pg` doesn't use `pg`, so there's no pool to share, and option 4 is the only way
  to get to one.
- **Error tracking:** `@sentry/effect` (alpha; same release line as `@sentry/node`), whose
  `effectLayer` reports failures at Effect's HTTP boundary. **Expected errors set
  `ErrorReporter.ignore`**, through a shared base class: by default, Sentry's reporter sends
  every typed error, 401s and 404s included, at level `error`. ADR-0019's "unexpected errors
  only" rule stands.
- **API behaviour:** create keeps returning **201** (annotated on the endpoint). A malformed id
  (`/api/applications/abc`) becomes **400**, from the parameter schema, instead of 404. A
  well-formed id for a missing row or another user's row is still **404, never 403**, so no
  existence leaks.
- **Migrations:** `drizzle-kit up` converts `apps/api/drizzle/` to 1.0's one-folder-per-migration
  layout once. The SQL is byte-identical (files are moved, not edited), so this is the one
  allowed exception to "never edit a merged migration". On a database the 0.45 migrator had
  fully migrated, the 1.0 migrator applies nothing and the 0.45 migrator still works afterwards.
  **But a migration that 1.0 applies looks unapplied to 0.45** (1.0 records timestamps to the
  second, 0.45 to the millisecond), and a rollback runs the previous release's migrator
  (ADR-0014). So rolling back to a 0.45 release is safe only while every migration in it was
  applied by 0.45 itself. Check production has all its migrations applied before deploying the
  upgrade. Found in the upgrade PR (#33) by testing a database that was one migration behind.
- **Tests:** still against the real `app_test` database (ADR-0008's point), through the
  generated client against `HttpRouter.toWebHandler`, using `@effect/vitest` (`it.live` for
  anything timing-dependent; `it.effect` runs on a simulated clock).

The migration happens in steps, each its own PR; see the [roadmap](../roadmap.md).

## Consequences

- **Typed failure end to end:** handlers declare their errors, the client receives them as
  tagged values, and Sentry gets the same chain with Postgres's own fields (`code`, `table`,
  `constraint`) and value kinds.
- **Tenancy becomes structural:** a handler that uses `CurrentUser` needs the `Authorization`
  middleware, or the server doesn't compile. The type error appears where the server is
  assembled, not at the route, which is a known gotcha to document.
- **More code at first:** the spike's 4 endpoints took 308 lines against 196 today for 7. Part of
  that is a one-off cost, and it buys typed errors, a typed client and OpenAPI.
- **Two pre-1.0 dependencies on the critical path** (`effect/http-api`, Drizzle 1.0), plus an
  alpha (`@sentry/effect`). All are published with SLSA provenance, and advisories cover
  pre-release ranges, so Dependabot alerts still apply. Drizzle's April SQL-injection fix
  (GHSA-gpj5-g38j-94v9) shipped in both lines. Rule: never pass user input to `sql.raw` or
  `sql.identifier`.
- **Agents need guidance:** CLAUDE.md gets an Effect conventions section built from the spike's
  gotchas (per-request route requirements, bidirectional schemas, the test clock, the ignore
  marker). The anti-slop Effect rules are switched on.
- **CLAUDE.md rules change when each step lands:** the layout, rule 6 (contract), rule 7
  (`app.inject()`), and rule 8's wording on malformed ids.
- **Revisit if:**
  - Drizzle 1.0 stalls or a release candidate breaks us badly. The fallback is option 2 with
    a corrected bridge.
  - `@sentry/effect` lags behind Effect releases.
  - An Effect minor release forces a large rewrite of the HTTP layer.
  - The frontend bundle grows past what the typed client is worth.
