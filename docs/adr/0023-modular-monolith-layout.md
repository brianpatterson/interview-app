# 0023. Organize the code by module, as a modular monolith

- **Status:** Accepted
- **Date:** 2026-11-12

## Context

The API was a flat `src/` folder: one `app.ts` held every handler, one `schema.ts` every table, and
all tests sat in `test/`. The web app was a flat list of components. That was fine at this size,
but it hides which code belongs to which part of the product. Two directions are likely:

- splitting the API into services (identity and applications are the obvious first cut), and
- giving the web app its own repo, possibly as several microfrontends.

Neither is worth doing yet. One server, one database and one deploy are the right size for the
traffic (ADR-0012). What we can do now is lay the code out so that a split later is a move, not an
untangling.

## Options considered

1. **Keep the flat layout.** No churn. But every new feature adds to the same few files, and the
   boundaries a split would need exist only in our heads.
2. **Organize by layer** (`handlers/`, `services/`, `repositories/`). Familiar, but one feature is
   spread across every folder, which is the opposite of what a split needs.
3. **Organize by module** (`modules/<name>/` holding a module's handlers, tables and tests, with
   a public `index.ts`), shared infrastructure in its own folder, and the same idea on the web.
   Each module is what a future service or microfrontend would become.
4. **Split into packages per module now** (`packages/applications`, …). Enforces boundaries with
   the package manager, but adds a `package.json`, build and tsconfig per module before anything
   needs them.

## Decision

Option 3: a modular monolith, organized by module, with boundaries enforced by a check rather than
by packages.

- **API** (`apps/api/src/`): `modules/{applications,identity,email}/`, each with an `index.ts`
  public interface, its handlers, its Drizzle tables (`schema.ts`) and its colocated tests.
  `platform/` holds infrastructure every module uses (config, database, observability).
  `server.ts` is the only file that assembles modules. Tests of the whole app (contract, client,
  production wiring) and the test helpers stay in `test/`.
- **Contract**: `packages/shared` becomes `packages/contract` (`@roundtable/contract`), one file per
  module. It's the only code shared by the API and the web app, and it's what a separate web repo
  would depend on.
- **Web** (`apps/web/src/`): `shell/` (the host: providers, layout, which module shows when),
  `modules/{identity,applications}/` each exporting one root component, and `shared/` for web-only
  plumbing. A themed `design-system/` will sit alongside them, decided in its own ADR.
- **Rules**, checked by `pnpm check:boundaries`:
  1. Import another module only through its `index.ts`.
  2. Modules never import `server.ts` or `shell/`.
  3. `platform/`, `shared/` and the design system never import from `modules/` (tests excepted:
     the database and logging tests use real tables).
  4. A module queries only its own tables. The one exception is the applications table's foreign
     key to `users`, which goes if applications ever gets its own database.

Dependencies run one way: applications → identity → email → platform. There is still one database
and one migrations folder: moving tables into module files changed no SQL.

## Consequences

- A future service is a module folder plus its tables: deploy it on its own, and give the remaining
  modules a second adapter at the seam. For identity, that seam is the `Authorization` middleware:
  today it checks the session in-process, and after a split it would ask the identity service.
- Tests sit next to the code they cover; the `#test/helpers` subpath import keeps their imports
  short wherever they live.
- More files and an `index.ts` per module to keep current. A module's public interface is now a
  deliberate list, which is the point, but it's one more thing to edit when adding an export.
- Revisit if the boundaries check keeps getting in the way (a sign the modules are cut wrong), or
  when a module first needs its own deploy, which would move it to its own package and database.
