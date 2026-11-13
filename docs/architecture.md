# Architecture

> **Living document.** This describes the system as it is _right now_. Update it in the same PR
> as any change to the components, data model, API, or infrastructure. The reasoning behind each
> choice lives in [ADRs](adr/README.md). Each dependency's alternatives are in
> [dependencies.md](dependencies.md).

_Last updated: 2026-11-12_

## 1. What the system does

Roundtable tracks software-engineering job applications: the company, the role, a link to the
job description, where the application stands, and when it was created and last changed. Each
user signs in (email and password, GitHub, or Google) and only ever sees their own applications.

## 2. Requirements and scale assumptions

| Dimension      | Now                                                                  | Planned                      |
| -------------- | -------------------------------------------------------------------- | ---------------------------- |
| Users          | multi-user with auth ([ADR-0011](adr/0011-authentication.md))        | ~12, possibly ~1,000s        |
| Rows per user  | hundreds                                                             | low thousands                |
| Read/write mix | read-heavy (list view), occasional writes                            | same                         |
| Availability   | single VPS, ~99.5–99.9% ([ADR-0012](adr/0012-hosting-single-vps.md)) | same until users demand more |

**Back-of-envelope estimate at the high end.** 5,000 users × 2,000 applications = 10M rows ×
~300 bytes ≈ 3 GB including indexes. Peak traffic is perhaps 5,000 users × 50 requests/day ≈
250k requests/day ≈ 3 req/s on average, maybe 30 req/s at peak. **One small Postgres instance and
one API process handle that easily.** At this scale the design challenges are correctness,
tenant isolation, and operability, not throughput. Section 8 lists what would change if that
stopped being true.

## 3. System context and containers

```mermaid
flowchart LR
  user([Job seeker]) -->|HTTPS| web

  subgraph Browser
    web[Web SPA<br/>React + Vite<br/>apps/web]
  end

  subgraph Server
    api[API<br/>Effect HttpApi on Node 26<br/>apps/api]
  end

  db[(PostgreSQL 17)]

  web -->|JSON over /api/*<br/>session cookie| api
  api -->|SQL via Drizzle| db
  api -.OAuth.-> idp[GitHub / Google]
  shared[[packages/shared<br/>Effect HttpApi contract + typed client]] -.imported by.-> web
  shared -.imported by.-> api
```

| Container         | Responsibility                                                                                                           | Tech                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `apps/web`        | UI. Server state is cached and refetched with TanStack Query, through the typed client.                                  | React 19, Vite 8, Effect 4 (client only)                                                                               |
| `apps/api`        | HTTP API, auth (sessions, OAuth), validation, persistence                                                                | Effect 4 HttpApi, Better Auth, Drizzle ORM (Effect driver on `@effect/sql-pg`, Promise driver on `pg` for Better Auth) |
| `packages/shared` | API contract as an Effect `HttpApi` definition, and the typed client generated from it that the web app calls (ADR-0022) | Effect 4                                                                                                               |
| PostgreSQL        | System of record                                                                                                         | Postgres 17 (Docker locally)                                                                                           |

In local dev, Vite proxies `/api/*` to the API, so the browser sees one origin and there is no
CORS setup. Production will keep the same-origin approach (section 7).

## 4. Data model

```mermaid
erDiagram
  users ||--o{ applications : owns
  users ||--o{ sessions : has
  users ||--o{ accounts : "signs in with"
  users {
    text id PK
    text email "UNIQUE"
    text name
    boolean email_verified
  }
  sessions {
    text id PK
    text token "UNIQUE, in the httpOnly cookie"
    text user_id FK
    timestamptz expires_at
  }
  accounts {
    text id PK
    text user_id FK
    text provider_id "credential | github | google"
    text password "scrypt hash, credential only"
  }
  verifications {
    text id PK
    text identifier "e.g. reset-password token"
    timestamptz expires_at
  }
  applications {
    uuid id PK "gen_random_uuid()"
    text user_id FK "NOT NULL, ON DELETE CASCADE"
    text company "NOT NULL"
    text job_title "NOT NULL"
    text job_url "nullable"
    application_status status "NOT NULL DEFAULT 'applied'"
    timestamptz created_at "also the application date"
    timestamptz updated_at "bumped on every update"
  }
```

- **Tenant isolation:** every `applications` query filters on `user_id` from the session. Another
  user's ids return 404, never 403, so the API doesn't confirm they exist. Tested in
  `apps/api/test/auth.test.ts`.
- `users`, `sessions`, `accounts` and `verifications` are shaped by Better Auth
  ([ADR-0011](adr/0011-authentication.md)). One user can have several `accounts` (a password plus
  GitHub, say), which is how account linking works.
- `application_status` is a Postgres enum: `applied → screening → interviewing → offer →
accepted`, plus the terminal states `rejected` and `withdrawn`. Transitions aren't enforced
  ([ADR-0006](adr/0006-status-enum-and-dates.md)).
- Index `applications_user_id_updated_at_idx (user_id, updated_at DESC)` serves the only list
  query: one user's applications, newest first.
- Source of truth: `apps/api/src/db/schema.ts`. Migrations are generated into `apps/api/drizzle/`,
  one folder each (`<timestamp>_<name>/migration.sql` + `snapshot.json`, Drizzle 1.0's layout)
  ([ADR-0004](adr/0004-drizzle-orm-and-migrations.md), [ADR-0022](adr/0022-effect-for-the-api.md)).

## 5. API

All routes are JSON under `/api`. The server is the Effect `HttpApi` definition in
`@roundtable/shared` ([ADR-0022](adr/0022-effect-for-the-api.md)): requests are decoded by its
schemas before any handler runs, a failed decode is a 400 RFC 9457 problem
(`application/problem+json`) naming each invalid value and why, and responses are encoded
through their schemas, so columns not in them (`userId`) never leave the server. Better Auth's
routes are mounted beside it. The web app calls the API through the client generated from the
same definition (`@roundtable/shared/client`): request bodies are encoded and checked before
they're sent, so invalid input fails in the browser with the server's own message; responses
are decoded (dates become `Date`s), so a contract mismatch fails at the boundary instead of deep
in the UI; and the contract's errors (`Unauthorized`, `ApplicationNotFound`) become messages for
the user. `client.test.ts` runs that client against the real server. The client costs about
40 KB gzipped of the web bundle (115 → 155 KB). Job URLs must be `http(s)`: the web app renders them as links, so `javascript:` or `data:` URLs
are rejected at the API rather than left to React and the CSP.

| Method   | Path                    | Auth    | Success | Errors                                                                |
| -------- | ----------------------- | ------- | ------- | --------------------------------------------------------------------- |
| GET      | `/api/health`           | public  | 200     | (reports `db: "down"` instead of failing)                             |
| GET      | `/api/auth-config`      | public  | 200     | (lists enabled social providers)                                      |
| GET/POST | `/api/auth/*`           | public  | varies  | Better Auth: sign-up/in/out, OAuth callbacks, password reset, session |
| GET      | `/api/applications`     | session | 200     | 401                                                                   |
| GET      | `/api/applications/:id` | session | 200     | 400 (malformed id), 401, 404 (unknown or not yours)                   |
| POST     | `/api/applications`     | session | 201     | 400, 401                                                              |
| PATCH    | `/api/applications/:id` | session | 200     | 400 (body or id), 401, 404                                            |
| DELETE   | `/api/applications/:id` | session | 204     | 400 (malformed id), 401, 404                                          |

The list isn't paginated. That's fine for hundreds of rows per user, and cursor pagination on
`(updated_at, id)` is the planned next step.

## 6. Request flows

### Changing a status

```mermaid
sequenceDiagram
  participant U as User
  participant W as Web (React Query)
  participant A as API (Effect HttpApi)
  participant D as Postgres
  U->>W: pick "interviewing"
  W->>A: PATCH /api/applications/:id {status} + session cookie
  A->>D: look up session by token
  D-->>A: user_id (or nothing → 401)
  A->>A: decode id + body with the contract (400 problem if invalid)
  A->>D: UPDATE … WHERE id = :id AND user_id = :user RETURNING *
  D-->>A: row (or nothing → 404)
  A-->>W: 200 Application
  W->>W: invalidate ["applications"] → refetch list
```

### Signing in with GitHub (OAuth 2.0 authorization code flow)

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as API (Better Auth)
  participant G as GitHub
  B->>A: POST /api/auth/sign-in/social {provider: github}
  A-->>B: redirect URL (with state + PKCE challenge)
  B->>G: user approves the app
  G-->>B: redirect to /api/auth/callback/github?code=…&state=…
  B->>A: GET callback
  A->>G: exchange code (+ PKCE verifier) for tokens, fetch profile
  A->>A: find or create user; link to an existing account only if both sides verified the email
  A-->>B: Set-Cookie session (httpOnly, SameSite=Lax), redirect to /
```

### Security properties

- **Sessions** are opaque random tokens stored in Postgres. They go in an `httpOnly`,
  `SameSite=Lax` cookie, which page JavaScript can't read, so a cross-site scripting bug can't
  steal it. Sign-out deletes the row, which revokes the session immediately (unlike a JWT).
- **CSRF:** any state-changing request that carries a cookie must have an `Origin` matching
  `BETTER_AUTH_URL`, and is otherwise rejected with 403. Better Auth turns this check off when
  `NODE_ENV=test`, so the config forces it on and a test proves it.
- **Passwords:** at least 10 characters, hashed with scrypt by Better Auth. Reset tokens are
  single-use and expire.
- **Brute force:** Better Auth's rate limiter (in-memory, production only) throttles auth
  endpoints. With more than one API instance it would need shared storage
  ([ADR-0011](adr/0011-authentication.md)).
- **Email verification:** email/password sign-ups get no session until they click a link sent to
  their address, so every account's email is proven (account linking depends on it). Emails go
  through Resend from `mail.<domain>`, signed with DKIM under a DMARC `quarantine` policy. In
  development they're written to the API log instead ([ADR-0017](adr/0017-email-resend.md)).
- **Password reset** signs out every other session.
- **Account linking:** a GitHub or Google sign-in joins an existing account with the same email
  only when the provider has verified that email **and** the existing account confirmed it.
  Tests cover both refusals (an unconfirmed local account, an unverified provider email), which
  are how an attacker would otherwise get into someone else's account.
- **Email abuse:** at most 5 reset or verification requests and 10 sign-ups per IP per hour
  (Better Auth, in memory), then at most 3 emails of each kind per address and 80 in total per
  24 hours (Postgres, survives deploys). Over a limit the email is silently dropped
  ([ADR-0018](adr/0018-email-sending-limits.md)).

## 7. Environments and delivery

### Production deployment

```mermaid
flowchart LR
  user([Browser]) -->|DNS lookup| cf[Cloudflare DNS<br/>A/AAAA, www, CAA<br/>DNS only, not proxied]
  user -->|HTTPS :443| caddy

  subgraph do["DigitalOcean nyc3: one droplet (1 vCPU, 1 GB), cloud firewall 22/80/443"]
    subgraph compose["Docker Compose (compose.prod.yml)"]
      caddy[web: Caddy<br/>TLS, SPA, headers]
      api[api: Node 26<br/>esbuild bundle]
      migrate[migrate<br/>one-off, runs first]
      db[(db: Postgres 17<br/>no public port)]
    end
    vol[[Volume /srv/data<br/>postgres + certs]]
  end

  caddy -->|/api/*| api
  api --> db
  migrate --> db
  db --- vol
  caddy --- vol
  le[Let's Encrypt] -.certificates.-> caddy
  gha[GitHub Actions<br/>nightly backup] -.SSH: pg_dump.-> db
  gha -.encrypted dump.-> r2[(Cloudflare R2<br/>30-day backups)]
```

- **Edge:** Caddy terminates TLS with automatic Let's Encrypt certificates, redirects HTTP and
  `www` to `https://<domain>`, serves the SPA (hashed assets cached for a year, `index.html`
  never cached), and sets HSTS, CSP, frame-deny and related headers.
- **Startup order:** `db` healthy → `migrate` exits 0 → `api` healthy → `web` starts. A failed
  migration means the new API never starts.
- **DNS:** records point straight at the reserved IP (Cloudflare's proxy is off). The CAA record
  allows Let's Encrypt; Cloudflare automatically adds its own CAs to that set.
- **Backups:** nightly, a GitHub Actions job streams `pg_dump` over SSH, encrypts it with age,
  uploads it to R2 (30-day retention, 7-day write-once lock), then restores that copy into a
  throwaway Postgres to prove it works. RPO 24 h, RTO about 15 min
  ([ADR-0015](adr/0015-backups.md)).
- **Email:** Resend's HTTP API, from `no-reply@mail.<domain>`. The API refuses to start in
  production without its key ([ADR-0017](adr/0017-email-resend.md)). A send that fails with a
  5xx, the per-second rate limit or a network error is retried twice more within about two
  seconds, under one idempotency key so Resend never delivers it twice; a 4xx or a used-up quota
  fails at once. Either way, the failure is logged and reported to Sentry with the email kind
  (`src/email.ts`, `src/email-limits.ts`).
- **Monitoring:** Better Stack checks `/api/health` (must report the database up) every 3
  minutes from outside, and opens an incident only if it's still failing 60 seconds later, so a
  deploy's ~10-second gap doesn't page anyone, and expects a ping from every nightly backup. Sentry receives unexpected
  API errors, failed email sends and the daily-email-limit alarm, with cookies, bodies, query
  strings and database query parameters (a failed session lookup's would be the session token)
  stripped, and no console breadcrumbs
  ([ADR-0019](adr/0019-monitoring-and-error-tracking.md)).
- **Logs:** JSON lines from pino on stdout, kept by Docker. Better Auth logs through the same
  logger, and so does Effect (request logs, failures) through a bridge in `src/logging.ts`, which
  must wrap the whole server (`serverLayer`): provided anywhere narrower, Effect's request logs
  go to the console unredacted. `test/server.test.ts` runs the real server to check it. Errors are logged as type, message and stack only, and every line is
  scrubbed of database query parameters before it's written (`src/logging.ts`, `src/redact.ts`).
- **Disposable server:** IPs and the data volume are separate OpenTofu resources, so the server
  can be replaced at any time ([infra/README.md](../infra/README.md)).
- **Infrastructure state:** OpenTofu state is in R2, encrypted on the operator's machine before
  upload and locked during runs ([ADR-0016](adr/0016-remote-encrypted-state.md)).

### Delivery pipeline

```mermaid
sequenceDiagram
  participant Dev as Developer / agent
  participant GH as GitHub (PR + CI)
  participant D as Deploy workflow
  participant R as GHCR
  participant S as Droplet (deploy.sh)
  Dev->>GH: PR → required checks → merge to main
  GH->>D: CI green on push to main (workflow_run)
  D->>D: diff against the last deployed commit: only docs/Markdown/infra? stop
  D->>R: build + push api/web images tagged <git SHA>
  D->>S: SSH as deploy (pinned host key), copy compose + deploy.sh
  D->>S: docker login with this run's token (throwaway config)
  S->>S: migrate → api → web, wait for /api/health db=up
  alt healthy within 90s
    S-->>D: ✓ record SHA in .deployed
  else migrations fail or unhealthy
    S->>S: print logs, redeploy previous SHA
    S-->>D: ✗ deploy failed (production on previous version)
  end
  D->>D: smoke test https://<domain>/api/health from outside
```

Each deploy recreates the API and Caddy containers, so the site is down for about 10 seconds
(Caddy waits for the new API to be healthy). That's why merges that only touch docs, Markdown,
agent config or `infra/` (applied by a human with OpenTofu) don't deploy: the workflow compares
the commit with the last successful deploy run and skips the build and deploy when nothing that
ships changed. A failed deploy exits non-zero, so it never counts as the base, and the next merge
deploys again. Zero-downtime deploys are on the roadmap.

Rollback restores code only; migrations must stay backward-compatible with the previous release
([ADR-0014](adr/0014-push-based-deploys.md)). A rollback runs the previous release's migrator
first, and the API only starts if it succeeds. One caveat from the Drizzle 1.0 upgrade: 1.0 records
a migration's timestamp to the second, 0.45 to the millisecond, so **a migration applied by 1.0
looks unapplied to 0.45**, which then fails re-running it. Rolling back to a 0.45 release is safe
only while every migration in that release was applied by 0.45 itself. Production qualified:
checked on 2026-11-11 (three rows) before 1.0 was deployed with #33. Local databases that lagged behind may not be: recreate them if a
pre-upgrade branch fails to migrate.

| Environment | Status                              | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local       | ✅ running                          | `docker compose` Postgres (databases `app` and `app_test`), `pnpm dev`. The production stack also runs locally: `docker compose -f compose.prod.yml` with `DOMAIN=localhost`.                                                                                                                                                                                                                                                                                   |
| CI          | ✅ GitHub Actions                   | `check` (required): lint (Oxlint, including the anti-slop rules, [ADR-0021](adr/0021-oxlint-with-anti-slop-rules.md)), format, typecheck, Effect diagnostics (`@effect/tsgo`, [ADR-0022](adr/0022-effect-for-the-api.md)), dependency register, migration drift, tests. `images`: both production images build. `infra`: `tofu fmt` + `validate`. Also CodeQL, dependency review and Dependabot ([ADR-0010](adr/0010-public-repo-and-supply-chain-scanning.md)) |
| Production  | ✅ live at https://roundtableapp.us | DigitalOcean + Cloudflare via OpenTofu ([ADR-0012](adr/0012-hosting-single-vps.md), [ADR-0013](adr/0013-digitalocean-instead-of-hetzner.md)); every green CI run on `main` deploys with health-checked rollback ([ADR-0014](adr/0014-push-based-deploys.md))                                                                                                                                                                                                    |

## 8. Known limits and what changes at scale

| Trigger                         | Change                                                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Need for history and analytics  | Append-only `application_events` table, so `updated_at` stops being the only trace                                |
| Lists in the thousands per user | Cursor pagination, plus server-side filter and sort                                                               |
| One server's CPU or RAM         | Bigger `server_type` (vertical scaling, minutes of downtime), then Postgres on its own server                     |
| Read load beyond one Postgres   | Connection pooling (PgBouncer), then a read replica. Caching only if measurements show it's needed                |
| Multiple API instances          | Already stateless (sessions live in Postgres), so add a load balancer. Move the rate limiter to Postgres or Redis |
