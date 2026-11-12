# Effect 4 HttpApi spike: findings

Throwaway spike (2026-11-10) to test the plan before writing an ADR: replace Fastify with Effect's
`HttpApi`, and keep Drizzle and Better Auth behind Effect services that convert Promises at the
edge. Effect 4.1.3, `@effect/platform-node` 4.1.3, `@effect/vitest` 4.1.3.

Covered: `GET /api/health`, applications `list`/`create`/`update`, Better Auth under
`/api/auth/*`, session middleware providing `CurrentUser`, a Drizzle transaction bridge, and 9
tests against the real `app_test` database. All 9 pass.

## The three open questions

### 1. Does Better Auth mount cleanly? Yes.

- The whole mount is `HttpRouter.add('*', '/api/auth/*', HttpEffect.fromWebHandler(auth.handler))`.
  Better Auth's handler is already `Request → Response`, so no header copying or body
  re-serialising is needed (the Fastify bridge in `routes/auth.ts` has 30 lines of that).
- Session middleware is about 15 lines (`Server.ts`, `AuthorizationLive`). It calls
  `auth.api.getSession` and provides `CurrentUser`. An unauthenticated request gets a **typed**
  `Unauthorized` (401) on the client.
- `createAuth` from `apps/api` was reused unchanged.

### 2. How awkward is the Drizzle transaction bridge? Avoidable: Drizzle 1.0 has native Effect support.

**Correction.** An earlier draft said the only Effect integration for Drizzle was `@effect/sql-drizzle`,
which is Effect 3 only. That's still true of that package, but it missed that **Drizzle itself ships
Effect support in 1.0**. It isn't in the `latest` 0.45 line (which `apps/api` uses), only in the
1.0 release candidate. `drizzle-orm@1.0.0-rc.5` (2026-10-21) has `drizzle-orm/effect-postgres`, Effect
query builders (`pg-core/effect`), tagged errors, an Effect migrator and `drizzle-orm/effect-schema`
(Effect Schema from tables, like `drizzle-zod`). It lists `effect >=4.0.0` and `@effect/sql-pg
>=4.0.0` as peers and is built on Effect's own Postgres client. Better Auth's Drizzle adapter
accepts `>=1.0.0-rc.1`.

Tested hands-on in `spikes/effect-drizzle` against `app_test`. All 7 tests pass:

- Queries are Effects with inferred row types; dates are `Date`s.
- `db.transaction(tx => effect)` is built in: commit, and rollback that keeps the body's typed error.
- **Interrupting a transaction rolls it back** (tested on the real clock). Plain `@effect/sql-pg`
  behaves the same.
- `createSelectSchema(table)` produces an Effect Schema that decodes real rows and rejects a bad
  enum value.
- A failed query is a tagged `EffectDrizzleQueryError`. Its message has the SQL but **no
  parameters** (unlike 0.45), but `params` is still a field on the error. The cause carries
  Postgres's fields (`code: 22P02`, with the value masked by Postgres as `'...'`).

The hand-written bridge (`Database.ts`, 73 lines) also works for commit and typed rollback. But
interrupting it (`test/bridge-interrupt.test.ts`) **leaves the transaction open on its pooled
connection** (`idle in transaction`, holding locks) until the process exits. Effect's HTTP server
interrupts a handler when the client disconnects, so in production every request aborted
mid-transaction would leak a connection until the pool ran out. That rules the bridge out.

#### Upgrading `apps/api` from Drizzle 0.45 to 1.0: measured

Done in a throwaway worktree off `main` (after #29), with `drizzle-orm` and `drizzle-kit`
1.0.0-rc.5 and no Effect yet. The patch is kept outside the repo.

- **Code changes: 3 lines plus 1 config line.**
  - `drizzle(pool, { schema })` becomes `drizzle({ client: pool })`, and `Db` becomes
    `NodePgDatabase`. We don't use the relational `db.query` API.
  - `casing` is no longer a `drizzle-kit` option. No column relied on it (every multi-word
    column is named explicitly), and the drift check confirms it.
  - `DrizzleQueryError.params` can be `undefined`.
- **Migrations change format, not content.** The 1.0 migrator refuses the old layout until
  `drizzle-kit up` converts it to one folder per migration (`20261028221959_create_applications/`
  with `migration.sql` + `snapshot.json`; the journal goes). The SQL is **byte-identical**: files
  are moved, not edited. CLAUDE.md's "never edit a merged migration" holds in spirit, but the
  ADR should say this one-time move is allowed.
- **Production database: safe.** Tested on a copy of a database the 0.45 migrator had migrated,
  like production:
  - The 1.0 migrator recognises all three migrations and applies nothing. It adds `name` and
    `applied_at` columns to `drizzle.__drizzle_migrations` and fills them in.
  - The 0.45 migrator then still runs without trouble, so a failed deploy that rolls the code
    back (ADR-0014) is safe.
  - An empty database migrates from scratch, and `db:generate` reports no drift.
- **Tests: 42 of 46 pass unchanged**, including every Better Auth test (sign-up, verification,
  sessions, OAuth account linking), so the adapter works on 1.0. The 4 failures are #29's leak
  tests. Each still proves the token is absent, but expects
  `params: <redacted: string(32)>`, and **Drizzle 1.0 leaves parameters out of errors by
  default** (`paramsInErrors: false`). So on 1.0 the leak #29 fixed doesn't happen in the first
  place, and #29's redaction stays as a second layer.
- **Trade-off to decide:** with parameters off by default, the value kinds #29 added (`uuid`,
  `string(32)`) aren't available. Turning on `paramsInErrors` would bring them back, with #29's
  redaction reducing them to kinds before anything leaves the process. Leaving it off is
  safer; turning it on keeps more for debugging. Postgres's own fields (`code`, `table`,
  `constraint`) arrive either way.
- **Unchanged:** the production image copies the whole `drizzle/` folder, so the new layout needs
  no Dockerfile change.
- **Two connection pools: not strictly required, but the best option.** `@effect/sql-pg` 4 has no
  dependency on `pg` (it implements the Postgres protocol itself), so there's no `pg.Pool` to share
  with Better Auth. Drizzle's Effect queries can't be awaited, so Better Auth's stock adapter can't
  use them. No Effect adapter for Better Auth exists. One pool is still possible two ways, and both
  are worse:
  - Write our own Better Auth adapter (`createAdapterFactory`) over the Effect database. We'd own
    the persistence layer for authentication and miss the fixes Better Auth ships for its own
    adapter (one was published 2026-10-27).
  - Use Promise-based Drizzle everywhere, with a corrected bridge that handles cancellation itself.
    We'd own subtle transaction code and give up the native Effect API.

  Two small pools on one Postgres (default `max_connections` is 100) cost only a few connections.

#### Is a release candidate a security risk?

Checked 2026-11-10:

- **Supply chain: no different from stable.** `drizzle-orm` 0.45.4, `drizzle-orm` and `drizzle-kit`
  1.0.0-rc.5, `effect`, `@effect/sql-pg` and `better-auth` are all published by GitHub Actions with
  signed SLSA provenance.
- **Security fixes reach the 1.0 line.** Drizzle's only advisory (GHSA-gpj5-g38j-94v9, high, SQL
  injection via improperly escaped identifiers, 2026-04-08) was fixed in both 0.45.2 and
  1.0.0-beta.20. Advisories cover pre-release ranges, so Dependabot alerts work for the rc.
- **The real rc risks:**
  - The new code (the Effect driver, codecs, the migrator) has seen less use. SQL generation is the
    part where a bug becomes a security hole, and the April advisory shows identifier handling is
    the weak spot. Mitigation: never pass user input to `sql.raw` or `sql.identifier`. That could be
    enforced with a lint rule.
  - A fix arrives as the next rc, which may carry breaking changes, so urgent patching could need
    code changes. Mitigation: pin exactly, and keep the tests good enough that upgrades are cheap.
  - The 1.0 rc has run for six months (rc.1 April, rc.5 October) while 0.45 still gets patches, so
    "1.0 final" may be a while off.
- **One way it's safer:** query parameters are left out of errors by default.
- **Bigger exposure than the ORM:** Better Auth has 26 published advisories, several critical, three
  from 2026-10-27. None affect 1.7.18, which we run. Staying current with it matters more than
  any choice of Drizzle version.
- **Open alert (Dependabot #2, medium, since 2026-11-03):** esbuild ≤ 0.24.2 lets websites read
  from esbuild's dev *server*. It comes only from drizzle-kit, through the deprecated
  `@esbuild-kit/esm-loader` (esbuild 0.18.20), in both 0.31.11 and 1.0.0-rc.5. drizzle-kit is a
  development CLI that doesn't run esbuild's server, and the production image is a bundle built with
  esbuild 0.28, so it isn't exploitable here. It still needs closing, either with a pnpm override or
  by dismissing it with that reason.

### 3. What does the frontend pay? About 46 KB more (gzipped).

Measured with Vite, the bundler the web app uses:

| Frontend option | Gzipped |
|---|---|
| Today's Zod contract | 25 KB |
| Effect contract module (Schema + `HttpApi` definitions) | 54 KB |
| Contract + generated typed client | 71 KB |
| Whole current web app | 113 KB |

With the typed client and Zod removed, the app goes from about 113 KB to about 159 KB (+40%).
Using Schema alone barely saves anything, because the contract module defines the `HttpApi`.

## What worked well

- **Typed errors end to end.** `ApplicationNotFound` (404) and `Unauthorized` (401) arrive as
  tagged values on the client: `error._tag === 'ApplicationNotFound'`, no status-code checks.
- **Validation before handlers.** Invalid bodies get a 400 without the handler running, and
  `Schema.Trim` cleans untrusted input on the server.
- **Responses are encoded through their schema.** The `userId` column is dropped automatically, so
  extra columns can't leak. Dates are real `Date`s on both sides and ISO strings on the wire.
- **Tests use the real pipeline with no port**, through `HttpRouter.toWebHandler` and the
  generated client. `@effect/vitest`'s `it.effect` works alongside ordinary vitest hooks.

## Gotchas (these will catch agents too)

1. **Everything in `effect/http-api` is `@stability unstable`** (329 of 329 documented items), and
   so is `HttpRouter`. Effect 4 itself is stable. Expect breaking changes in minor releases, so pin
   exactly.
2. **A route handler's requirements are per request.** `Layer.provide` on the router doesn't
   satisfy them. The Better Auth route needed `Layer.unwrap` to resolve the service at build time.
   The type error appears only at `toWebHandler` ("Expected 2 arguments"), far from the cause. I
   found the cause with a type probe.
3. **`CurrentUser` enforcement is real but distant.** Using it on a route without the middleware
   leaks a requirement, and compilation fails, but only where the server is built. The handler
   itself isn't flagged.
4. **Schemas are bidirectional.** The client *encodes* payloads, so `Schema.Trim` means the value
   must already be trimmed in code. Passing `'  Acme  '` through the typed client is a runtime
   encoding error, even though TypeScript sees a plain `string`.
5. **`it.effect` runs on a simulated clock.** In `@effect/vitest`, `Effect.sleep` never finishes
   inside `it.effect` unless the test advances the clock. A sleep-then-interrupt test hangs and
   looks like a library bug: I blamed Drizzle until the same hang showed up with plain
   `@effect/sql-pg`. Use `it.live` for anything that depends on real time.
6. **Behaviour differences from Fastify to handle in a real port:**
   - `create` returns 200 instead of 201.
   - A malformed id is a 400 (schema decoding) instead of today's 404.
   - Request logging is on by default (`disableLogger`).

## Error tracking: `@sentry/effect`

An earlier draft said Sentry's Fastify integration had no Effect replacement. That was wrong.
`@sentry/effect` 11.12.0 (official, **alpha**, same release as `@sentry/node`) supports Effect 4.
`Sentry.effectLayer(options)` initialises Sentry and registers an Effect `ErrorReporter`, so
failures at Effect's built-in HTTP boundary are reported automatically. It takes the same
`NodeOptions`, so today's `dataCollection` and `scrubEvent` settings carry over.

Measured with a recording `ErrorReporter` (`test/reporting.test.ts`):

| Request | Status | Reported by default |
|---|---|---|
| No session (`Unauthorized`) | 401 | **yes** |
| Missing or another user's row (`ApplicationNotFound`) | 404 | **yes** |
| Invalid body (schema decode) | 400 | no |
| Unknown route | 404 | no |
| Database down (defect) | 500 | yes |

**Gotcha:** our own typed 4xx errors are reported. Sentry's reporter sends any error not marked
`ErrorReporter.ignore`, at level `"error"` unless the error carries its own severity. So every 401
and 404 would become a Sentry issue, which emails on first occurrence. The fix is
`readonly [ErrorReporter.ignore] = true` on each expected error class. With it, only the 500 is
reported, which matches today's "unexpected errors only" policy (ADR-0019). In the real port, put
it on a shared base class so a new 4xx error can't be forgotten, and add a test like the one here.

**The root cause does reach Sentry.** `test/sentry.test.ts` runs the real `@sentry/effect` layer
(dummy DSN; `beforeSend` captures the event and returns null) during a database outage. The
event's exception chain is complete: Better Auth's `APIError("Failed to get session")` → Drizzle's
`Failed query: …` → `AggregateError` → `ECONNREFUSED` (IPv4 and IPv6), each with its own stack.
Keep `@sentry/effect` and `@sentry/node` on the same version, or their types clash.

**Security finding (affects production today, not just the port).** Drizzle's error message
includes the query's parameters. For the session lookup, the parameter is the **raw session
token**, so the event carries a live credential. A probe against today's Fastify API, with
production's `scrubEvent` applied, confirmed it: token present in the event. `scrubEvent` cleans
request data but not exception messages. Any failed Drizzle query reports its parameters this
way, so this isn't limited to session tokens. The fix belongs in `apps/api` on `main`: strip the
`params:` part of exception values in `scrubEvent`, with a regression test. It's tracked
separately from this spike.

## Size

The spike's `Api.ts` + `Database.ts` + `Server.ts` come to 308 lines for 4 endpoints and the auth
mount. Today's `routes/applications.ts` + `routes/auth.ts` + `packages/shared` are 196 lines for 7
endpoints. Part of the difference is a one-off cost (`Database.ts`), and the spike adds typed
errors, a typed client and OpenAPI. Expect the port to grow the code, not shrink it.

## Verdict

The plan holds, with one change. Replace Fastify with `HttpApi` and keep Better Auth behind a
service. For the database, use **Drizzle 1.0's native Effect support** rather than wrapping
Drizzle 0.45 in a hand-written bridge, which leaks connections on interruption. No blocker was
found. The real costs are the `unstable` label on the HTTP layer, Drizzle 1.0 being a release
candidate, error messages that point far from their cause, and about 46 KB on the frontend.
