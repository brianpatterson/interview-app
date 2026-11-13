# Architecture Decision Records

An ADR records one significant decision: the context, the options considered, what was chosen,
and the consequences. ADRs are **append-only**. To change a decision, write a new ADR that
supersedes the old one, and set the old one's status to `Superseded by ADR-NNNN`. That way the
history of _why_ the system looks the way it does is never lost.

Write an ADR when a choice is hard to reverse, affects more than one component, or is something
you'd want to explain in an interview. Copy [template.md](template.md).

| #    | Decision                                                                                                         | Status                                               |
| ---- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 0001 | [Record architecture decisions](0001-record-architecture-decisions.md)                                           | Accepted                                             |
| 0002 | [TypeScript monorepo with pnpm workspaces](0002-typescript-monorepo-pnpm.md)                                     | Accepted                                             |
| 0003 | [PostgreSQL as the system of record](0003-postgresql.md)                                                         | Accepted                                             |
| 0004 | [Drizzle ORM with checked-in SQL migrations](0004-drizzle-orm-and-migrations.md)                                 | Accepted                                             |
| 0005 | [Shared Zod schemas as the API contract](0005-shared-zod-contract.md)                                            | Superseded by [ADR-0022](0022-effect-for-the-api.md) |
| 0006 | [Status as a Postgres enum; creation date as application date](0006-status-enum-and-dates.md)                    | Accepted                                             |
| 0007 | [Separate SPA and REST API](0007-separate-spa-and-rest-api.md)                                                   | Superseded by [ADR-0022](0022-effect-for-the-api.md) |
| 0008 | [Integration tests against a real Postgres](0008-integration-tests-real-postgres.md)                             | Superseded by [ADR-0022](0022-effect-for-the-api.md) |
| 0009 | [Defer authentication; single-tenant for now](0009-defer-authentication.md)                                      | Superseded by 0011                                   |
| 0010 | [Public repository with automated supply-chain and code scanning](0010-public-repo-and-supply-chain-scanning.md) | Accepted                                             |
| 0011 | [Self-hosted authentication with Better Auth](0011-authentication.md)                                            | Accepted                                             |
| 0012 | [Host on a single Hetzner VPS, provisioned with OpenTofu](0012-hosting-single-vps.md)                            | Superseded by 0013                                   |
| 0013 | [Host on DigitalOcean instead of Hetzner; R2 for off-site storage](0013-digitalocean-instead-of-hetzner.md)      | Accepted                                             |
| 0014 | [Push-based deploys from GitHub Actions over SSH, with health-checked rollback](0014-push-based-deploys.md)      | Accepted                                             |
| 0015 | [Back up nightly with encrypted pg_dump to R2, and restore-test every backup](0015-backups.md)                   | Accepted                                             |
| 0016 | [Keep OpenTofu state in R2, encrypted client-side](0016-remote-encrypted-state.md)                               | Accepted                                             |
| 0017 | [Send email through Resend from a subdomain, and require email verification](0017-email-resend.md)               | Accepted                                             |
| 0019 | [Monitor from outside with Better Stack, track errors with Sentry](0019-monitoring-and-error-tracking.md)        | Accepted                                             |
| 0020 | [Rename the app to Roundtable, keeping three server-level names](0020-rename-to-roundtable.md)                   | Accepted                                             |
| 0018 | [Limit auth emails per IP, per address and per day](0018-email-sending-limits.md)                                | Accepted                                             |
| 0021 | [Lint with Oxlint only, including the anti-slop rules](0021-oxlint-with-anti-slop-rules.md)                      | Accepted                                             |
| 0022 | [Build the API on Effect 4: HttpApi, an Effect Schema contract and Drizzle 1.0](0022-effect-for-the-api.md)      | Accepted                                             |
| 0023 | [Organize the code by module, as a modular monolith](0023-modular-monolith-layout.md)                            | Accepted                                             |
