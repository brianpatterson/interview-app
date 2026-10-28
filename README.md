# app

Full-stack TypeScript monorepo (pnpm workspaces).

| Path              | What                                          |
| ----------------- | --------------------------------------------- |
| `apps/web`        | React + Vite frontend (http://localhost:5173) |
| `apps/api`        | Fastify API (http://localhost:3001)           |
| `packages/shared` | Types shared by web and api                   |

## Run it

```bash
pnpm install
cp .env.example .env   # first time only
pnpm db:up             # start Postgres in Docker
pnpm dev               # start web + api
```

Vite proxies `/api/*` to the API, so the frontend calls `fetch('/api/...')`.

## Scripts

- `pnpm typecheck`: type-check every package
- `pnpm lint`: ESLint
- `pnpm format`: Prettier
- `pnpm db:down`: stop Postgres (data is kept in a Docker volume)
