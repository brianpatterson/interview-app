# 0019. Monitor from outside with Better Stack, track errors with Sentry

- **Status:** Accepted
- **Date:** 2026-11-08

## Context

Production has real users, an email path that can fail silently, and a nightly backup job. Until
now, every failure was invisible unless someone happened to look:

- **Outages:** if the droplet, Docker, Caddy or Postgres stopped, nobody would know until a user
  complained.
- **Errors:** a 500 left a line in `docker compose logs` on the server, and nothing else. One
  important class is worse: Better Auth swallows errors from email callbacks (it only
  `console.error`s them) and still tells the user "check your email". A broken Resend key would
  mean every sign-up silently never completes.
- **Backups:** a failed backup run sends a GitHub email, but a run that never happens (GitHub
  disables scheduled workflows after 60 days without commits, outages, a deleted secret making the
  job skip) sends nothing ([ADR-0015](0015-backups.md)).
- **Abuse:** the daily email limit ([ADR-0018](0018-email-sending-limits.md)) logs an error that
  nobody reads.

Budget: $0.

## Options considered

**Uptime and backup heartbeat:**

1. **Better Stack (chosen).** Free plan: 10 monitors and 10 heartbeats, 3-minute checks from
   several regions, email alerts, and an official OpenTofu provider. One account covers both jobs.
2. **UptimeRobot + Healthchecks.io.** Both excellent and free, but two accounts, and UptimeRobot's
   free plan is limited to non-commercial use with 5-minute checks.
3. **A scheduled GitHub Actions job that curls the site.** Free, but it fails exactly when GitHub
   does, scheduled runs are often late, and it can't watch the backup job, which also runs on
   GitHub.
4. **Self-hosted (Uptime Kuma).** On the same droplet it can't report the droplet being down; on
   another server it costs money.

**Error tracking:**

1. **Sentry (chosen).** The industry standard: errors grouped into issues with stack traces,
   an email on each new issue, release tracking. Free for 5,000 errors a month, one user.
2. **GlitchTip.** Open-source and Sentry-compatible (same SDK), but self-hosting needs more memory
   than our 1 GB droplet has, and the hosted free plan is 1,000 events a month.
3. **Ship logs to a log service and alert on `error` lines** (Better Stack Logs, Grafana Cloud).
   Gives searchable history too, but errors aren't grouped and alert rules are cruder. Worth
   adding later for logs; it doesn't replace error tracking.
4. **Nothing beyond `docker compose logs`.** Free, and it's what we had.

How the API reports to Sentry:

- **`@sentry/node` v11 (chosen).** The official SDK. Version 11 dropped most of v10's
  OpenTelemetry dependencies, so it bundles with esbuild and adds about 70 KB to the bundle.
- **`@sentry/node` v10, or the lightweight `@sentry/node-core`.** v10 pulls in dozens of
  OpenTelemetry packages; `node-core` still tracks v10.

## Decision

- **OpenTofu (`infra/monitoring.tf`) manages Better Stack:**
  - A keyword monitor on `https://<domain>/api/health` requiring `"db":"up"` every 3 minutes,
    which also warns 14 days before the TLS certificate expires.
  - A heartbeat for backups: period 24 hours plus 12 hours of grace (GitHub has started scheduled
    runs 8 hours late).
  - The nightly backup workflow pings it on success, and pings `/fail` on failure so that alerts
    right away.
- **Sentry, API only, errors only:**
  - Reported: 5xx from our routes, unexpected errors inside Better Auth (its `onAPIError` hook,
    which skips normal 4xx), every failed email send (reported in the mailer itself, since Better
    Auth hides them), the daily email limit being hit, and uncaught exceptions.
  - Not reported: no performance tracing.
  - **Data sent is minimal by configuration:** v11's defaults collect cookies, request bodies,
    query strings and local variables. We turn all of those off, keep three harmless headers, and
    a `beforeSend` scrubber strips query strings (one-time tokens such as `verify-email?token=`
    sign their holder in) and identifying headers as a second line of defence.
  - `SENTRY_RELEASE` is the deployed image tag, so each error names the commit it came from.
- **The web app gets no Sentry yet.** It would need a build-time DSN, a CSP change (or a tunnel
  route) and about 25 KB more JavaScript, and nearly every real failure path is on the server.
  Revisit if browser-only bugs show up.

## Consequences

- **Every class of failure listed above now emails someone,** without logging in anywhere.
- **Two more accounts and secrets:** the Better Stack API token (in `terraform.tfvars`, used only
  by OpenTofu) and the Sentry DSN (in the server's `.env`). A DSN only allows sending events, not
  reading them.
- **Some data leaves our infrastructure:** stack traces, the route that failed, user agents, and
  error messages. Error messages can contain user data (for example a provider's error naming an
  email address). That's acceptable for a job tracker; the scrubber is the place to tighten it.
- **Free-plan limits:** 5,000 errors a month in Sentry. A crash loop could use that up; Sentry
  then drops events until the month resets, and Better Stack still catches the outage.
- **Without the secrets, nothing breaks:** no DSN means Sentry stays off; no heartbeat URL means
  the backup workflow skips its ping. Development and tests run without either.
- **Revisit when:** we need searchable log history (→ a log service), browser errors matter
  (→ Sentry in the web app), or someone besides the owner should get alerts (→ Better Stack
  on-call and Slack, Sentry team plan).
