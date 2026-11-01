# Interview App: agent instructions

Full-stack TypeScript monorepo for tracking job applications. Also a learning project for systems
design, a "software factory" workflow, and real production deploys, so **documentation is part of
every change, not an afterthought.**

## Layout

- `apps/web`: React 19 + Vite SPA. Uses TanStack Query for server state and calls `/api/*` (Vite proxies to the API).
- `apps/api`: Fastify 5 + Drizzle ORM + Postgres. `src/app.ts` builds the app, `src/routes/` holds routes, `src/db/schema.ts` is the schema source of truth.
- `packages/shared`: Zod schemas and types, the API contract. Consumed as TS source.
- `docs/`: `architecture.md` (current state), `adr/` (decisions), `dependencies.md` (dependency register).

## Commands

```bash
pnpm db:up          # start Postgres (dbs: app, app_test)
pnpm dev            # web :5173 + api :3001
pnpm db:generate    # after editing schema.ts: writes a SQL migration to apps/api/drizzle/
pnpm db:migrate     # apply migrations to the dev db
pnpm check          # lint + format check + typecheck + dependency register + tests: run before every commit
```

## Rules for every change

1. **Work on a branch and open a PR.** Never commit straight to `main`.
2. **Dependencies:** adding, removing or replacing a package means updating `docs/dependencies.md`
   with its purpose, the main alternative, and why this one won. `pnpm check:deps` enforces this.
3. **Decisions:** any choice that's hard to reverse or crosses components (data model, new
   service, hosting, auth, caching, a new pattern) gets an ADR in `docs/adr/` from `template.md`,
   plus a row in `docs/adr/README.md`. Never edit an accepted ADR's decision. Supersede it with a
   new one instead.
4. **Architecture doc:** if a change touches components, the data model, the API surface,
   environments or scale limits, update `docs/architecture.md` (diagrams included) and its
   "Last updated" date.
5. **Schema changes:** edit `schema.ts`, run `pnpm db:generate --name <what_changed>`, and commit
   the SQL. Never edit a migration that has been merged. CI fails if the schema and migrations
   drift.
6. **API contract:** request and response shapes live in `packages/shared`. Validate every
   request body and param with them.
7. **Tests:** API behavior changes need a test in `apps/api/test/`. Tests hit the real `app_test`
   database through `app.inject()`. Don't mock the database.

## Conventions

- Conventional commit subjects (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
- TypeScript is pinned to `~6.0` until typescript-eslint supports TS 7.
