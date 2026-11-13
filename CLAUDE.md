# Roundtable: agent instructions

Full-stack TypeScript monorepo for tracking job applications. Also a learning project for systems
design, a "software factory" workflow, and real production deploys, so **documentation is part of
every change, not an afterthought.**

## Layout

- `apps/web`: React 19 + Vite SPA. Uses TanStack Query for server state and calls `/api/*` through
  the typed client from `@roundtable/shared/client` (Vite proxies to the API).
- `apps/api`: Effect 4 `HttpApi` + Drizzle ORM + Postgres (ADR-0022). `src/app.ts` builds the server
  (handlers for the contract in `@roundtable/shared`, the `Authorization` middleware, Better
  Auth's route); `src/index.ts` runs it. `src/db/schema.ts` is the schema source of truth,
  `src/db/effect.ts` the Effect database, `src/auth.ts` configures Better Auth, `src/env.ts`
  validates environment variables.
- `packages/shared`: the API contract, consumed as TS source. `src/index.ts` is the Effect
  `HttpApi` definition (endpoints, schemas, errors); `src/client.ts` (`@roundtable/shared/client`)
  is the typed client generated from it, which the web app calls and `client.test.ts` runs against
  the real server. Everything here ships to the browser: no server code.
- `infra/`: OpenTofu for production (DigitalOcean droplet, volume, reserved IP, firewall, Cloudflare DNS) and cloud-init. See `infra/README.md`.
- `compose.prod.yml`, `apps/*/Dockerfile`, `apps/web/Caddyfile`: the production runtime.
- `docs/`: `architecture.md` (current state), `adr/` (decisions), `dependencies.md` (dependency register), `roadmap.md` (where this is going).

## Commands

```bash
pnpm db:up          # start Postgres (dbs: app, app_test)
pnpm dev            # web :5173 + api :3001
pnpm db:generate    # after editing schema.ts: writes a SQL migration to apps/api/drizzle/
pnpm db:migrate     # apply migrations to the dev db
pnpm check:effect   # Effect diagnostics (mistakes tsc can't see, e.g. an Effect that is never run)
pnpm check          # lint + format + typecheck + Effect diagnostics + dependency register + tests: run before every commit
```

## Rules for every change

1. **Work on a branch and open a PR.** Never commit straight to `main`.
2. **Dependencies:** adding, removing or replacing a package means updating `docs/dependencies.md`
   with its purpose, the main alternative, and why this one won. `pnpm check:deps` enforces this.
   pnpm refuses versions published in the last 24 hours (`minimumReleaseAge`, a supply-chain
   safeguard). If `pnpm add` writes a `minimumReleaseAgeExclude` entry into
   `pnpm-workspace.yaml`, don't keep it: revert the files and pin the newest version old enough.
3. **Decisions:** any choice that's hard to reverse or crosses components (data model, new
   service, hosting, auth, caching, a new pattern) gets an ADR in `docs/adr/` from `template.md`,
   plus a row in `docs/adr/README.md`. Never edit an accepted ADR's decision. Supersede it with a
   new one instead.
4. **Architecture doc:** if a change touches components, the data model, the API surface,
   environments or scale limits, update `docs/architecture.md` (diagrams included) and its
   "Last updated" date.
5. **Schema changes:** edit `schema.ts`, run `pnpm db:generate --name <what_changed>`, and commit
   the generated folder (`apps/api/drizzle/<timestamp>_<name>/`). Never edit a migration that has been merged. CI fails if the schema and migrations
   drift. Every migration must be **backward-compatible with the previous release**, because a
   failed deploy rolls back the code but not the database (ADR-0014). Expand/contract: add
   (nullable or defaulted) first, start using it in a later release, remove only after nothing
   reads it.
6. **API contract:** request and response shapes live in `packages/shared`. Validate every
   request body and param with them (the `HttpApi` does this before handlers run). The client
   encodes request bodies with the same schemas before sending them, so a transformation must
   work in both directions (see `Text` in `index.ts`). `apps/api/test/contract.test.ts` pins
   what the schemas accept and fails if the endpoints differ from the routes served. A new
   error needs a user-facing message in `client.ts`.
7. **Tests:** API behavior changes need a test in `apps/api/test/`. Tests hit the real `app_test`
   database through `t.inject()` from `setupTestApp()` in `test/helpers.ts`, never the server
   framework directly, so the server can change underneath them (ADR-0022). Don't mock the
   database. Use `signUp()` from the same file to get a session cookie.
8. **Auth and tenancy:** every endpoint that touches user data is in a group behind the
   `Authorization` middleware, and every query filters on the `CurrentUser` it provides.
   Another user's rows are a 404, never a 403 (a malformed id is a 400 from the params schema,
   which reveals nothing). Add a cross-user test for any new resource.
9. **Config:** new environment variables go in `src/env.ts` (an Effect Schema read through
   `Config`), `.env.example` (documented), and, if production needs them, `compose.prod.yml` and
   `.env.prod.example`. A secret (a key, password, token, or a URL that contains one) is a
   `Secret` there, so it's a `Redacted` that prints as `<redacted>`: unwrap it with
   `Redacted.value` only where it's handed to the library that uses it, and add it to the leak
   test in `test/env.test.ts`. Never commit secrets. `.env` is git-ignored.
10. **Infrastructure:** changes to `infra/` must pass `tofu fmt -check`, `tofu validate` and
    `infra/test-cloud-init.sh`. Never run `tofu apply` yourself; a human reviews the plan and
    applies it.

## Conventions

- Conventional commit subjects (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
- Lint is Oxlint only (ADR-0021): core, TypeScript and React hooks rules, plus the vendored
  anti-slop rules (`tools/oxlint/anti-slop/`). In `.oxlintrc.json`, always write rules with their
  plugin prefix (`typescript/no-namespace`); a bare name can resolve to another plugin's rule
  and silently do nothing. Fix findings, don't suppress them: put a `// SAFETY:` comment stating the checked
  invariant before any type assertion, parse input with Effect Schema instead of passing
  `unknown` or `object` around, and let `pnpm lint:fix` add blank lines. Update the plugin only through the
  `install-anti-slop` skill.
- TypeScript 7 (the native Go port, `^7.0`). Vite, Vitest, tsx and esbuild strip types
  themselves and Oxlint has no type-aware rules on. Two tools use the compiler: `tsc`, and
  `@effect/tsgo` (`check:effect`), which ships Effect-patched builds **for specific TypeScript
  versions**. Upgrade TypeScript only to a version `@effect/tsgo`'s release supports (its README
  lists them), and check the same before adding another compiler-based tool.
- GitHub Actions: pin third-party actions (anything outside `actions/*` and `github/*`) to a full
  commit SHA with the version in a comment. Dependabot keeps the pins current. Give every workflow
  an explicit `permissions:` block (default `contents: read`). Every job sets `timeout-minutes` (GitHub's
  default is 6 hours, so a hung step blocks a PR for that long).

## Effect conventions

The API is moving to Effect 4 ([ADR-0022](docs/adr/0022-effect-for-the-api.md), steps in
`docs/roadmap.md`). These come from mistakes made in the spike
([findings](docs/research/2026-11-effect-spike.md)):

- **Versions:** `effect` and `@effect/*` are pinned exactly and upgraded together (Dependabot's
  `effect` group). `effect/http-api` and `@effect/vitest` are marked unstable: a bump may need code
  changes, so read its diff.
- **Errors:** define them with `Schema.TaggedError`. Handle them with `Effect.catchTag`,
  `catchTags` or `Match`, never by comparing or switching on `_tag`, and never build a `{ _tag }`
  object by hand: the anti-slop Effect rules reject both. Expected outcomes (401, 404) set
  `readonly [ErrorReporter.ignore] = true`, or Sentry reports them as errors.
- **Services:** `Context.Service` with a static `layer`; methods with `Effect.fn`. Yield the
  service, and let requirements propagate to where the app is assembled.
- **Route requirements are per request.** `Layer.provide` on the router doesn't satisfy a
  handler's own requirements; resolve the service while building the route (`Layer.unwrap`). The
  type error shows up far from the route, where the server is assembled ("Expected 2 arguments").
- **Schemas work in both directions.** A typed client _encodes_ what you pass, so a transform
  like `Schema.Trim` means the value must already be trimmed in code. Untrusted input is decoded
  (and trimmed) on the server.
- **Promise boundaries stay at the edges** (Better Auth's handler, the Promise-based Drizzle
  instance it uses). Never run an Effect inside a Promise callback that holds a resource: an
  interrupted request leaked a pooled connection that way in the spike. When a library calls
  back with Promises (Better Auth's email hooks), capture the context while building its layer
  and run the service with `Effect.runPromiseWith(context)`, as `appLayer` does for the
  `Mailer`: the callback then logs and reports like a route.
- **Report failures you handle** with `ErrorReporter.report(cause)` rather than calling Sentry,
  and give the error `[ErrorReporter.attributes]` for what helps triage (the email kind): the
  reporter sends them as `extra`. Never put user data in them.
- **Tests:** `@effect/vitest`. `it.effect` runs on a simulated clock (time passes only through
  `TestClock.adjust`); use `it.live` for anything that waits on real time or I/O
  (`test/effect-testing.test.ts`). Tests still hit the real `app_test` database.
- **`pnpm check:effect` must pass.** Fix findings rather than suppressing them. The only rule
  switched off is `unstableApiUsage`, because ADR-0022 accepted those APIs.
