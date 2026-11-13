# Roundtable

Track software-engineering job applications. Also a learning project for systems design, a
"software factory" workflow, and real production deploys.

| Path                | What                                                 |
| ------------------- | ---------------------------------------------------- |
| `apps/web`          | React + Vite frontend (http://localhost:5173)        |
| `apps/api`          | Effect HttpApi + Drizzle API (http://localhost:3001) |
| `packages/contract` | API contract (Effect `HttpApi`) and typed client     |
| `docs/`             | Architecture, decisions, dependency register         |

## Docs

- [Architecture](docs/architecture.md): the system as it is now (diagrams, data model, API, scale limits)
- [Architecture Decision Records](docs/adr/README.md): why it's built this way
- [Dependency register](docs/dependencies.md): every dependency, its alternative, and why it won
- [Roadmap](docs/roadmap.md): production deploy, the software factory, and quality layers
- [CLAUDE.md](CLAUDE.md): rules for AI agents (and humans) changing this repo

## Run it

```bash
pnpm install
cp .env.example .env   # first time only, then set BETTER_AUTH_SECRET (openssl rand -base64 32)
pnpm db:up             # start Postgres in Docker (creates app and app_test databases)
pnpm db:migrate        # apply migrations
pnpm dev               # start web + api
```

## Scripts

- `pnpm check`: everything CI runs (lint, format, typecheck, dependency register, tests)
- `pnpm lint:fix`: apply Oxlint autofixes (the anti-slop blank-line rule is autofixable)
- `pnpm test`: API integration tests against the `app_test` database
- `pnpm db:generate --name <change>`: generate a SQL migration after editing a module's `schema.ts` (`apps/api/src/modules/*/schema.ts`)
- `pnpm db:migrate`: apply migrations
- `pnpm db:down`: stop Postgres (data is kept in a Docker volume)

## Production

`compose.prod.yml` runs Caddy + API + Postgres. Try it locally with `DOMAIN=localhost` (see
`.env.prod.example`). The servers are defined in [infra/](infra/README.md).
