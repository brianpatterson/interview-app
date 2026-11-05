# 0014. Push-based deploys from GitHub Actions over SSH, with health-checked rollback

- **Status:** Accepted
- **Date:** 2026-11-05

## Context

Production is one droplet running `compose.prod.yml` ([ADR-0012](0012-hosting-single-vps.md),
[ADR-0013](0013-digitalocean-instead-of-hetzner.md)). Every merge to `main` should reach
production automatically, with nothing stored on the server that could deploy arbitrary code,
and a bad release must not stay live.

## Options considered

1. **Push over SSH from GitHub Actions** (build → registry → `ssh deploy.sh`): simple, every step
   is visible in the Actions log, and the pipeline is the only thing that changes production.
2. **Pull-based (Watchtower polling the registry)**: no inbound SSH from CI, but a pushed `latest`
   tag goes live with no health gate or rollback, and the deploy history is invisible.
3. **Kamal** (37signals' SSH deploy tool): zero-downtime proxying and a nice CLI, but another
   abstraction (and Ruby) on top of Compose, hiding what this project wants to learn.
4. **GitOps agent (Argo CD/Flux)**: needs Kubernetes, far too heavy for one server.

## Decision

`.github/workflows/deploy.yml` runs after a **green CI run from a push to this repository's
`main`** (or manually):

1. **Build** both images and push them to GitHub Container Registry, tagged with the **git
   SHA** (immutable, so deploys and rollbacks are exact) and `latest`.
2. **Deploy** in the protected `production` environment: SSH as `deploy` with a key generated
   by OpenTofu, to a **pinned host key** also from OpenTofu (no trust-on-first-use). Copy
   `compose.prod.yml` and `deploy/deploy.sh`, and log the server into the registry with **this
   run's short-lived token** in a throwaway Docker config.
3. `deploy.sh` starts the new images (migrate → api → web) and waits for
   `https://<domain>/api/health` to report the database up. If migrations fail or health doesn't
   come up within 90 seconds, it prints the logs and **redeploys the previous SHA**.
4. A **smoke test from outside** (the runner) checks the public URL.

Production config (`.env`, generated once on the server by `deploy/init-env.sh`) and deploy state
(`.deployed`, the current SHA pair) live on the data volume, so they survive droplet replacement.

## Consequences

- **Rollback restores code, not the database.** Migrations have already run, so every migration
  must be **backward-compatible** with the previous release (expand/contract: add columns before
  using them, remove only after no deployed code reads them). This is now a rule in CLAUDE.md.
- **Not zero-downtime.** The API restarts in place, giving a few seconds of 502s per deploy, and
  up to ~90 seconds plus a rollback when a release is bad. Acceptable at this scale; the fix is
  two API replicas behind Caddy, rolled one at a time.
- SSH is open to the internet for GitHub-hosted runners (key-only, fail2ban). A self-hosted
  runner or Tailscale would close it.
- The `deploy` user is in the `docker` group, which is effectively root on that box. A leaked
  deploy key equals server compromise; it lives only in OpenTofu state and the GitHub environment
  secret.
- Fork safety: `workflow_run` with `branches: [main]` matches by branch _name_, so the job also
  requires `event == push` from this repository. Without that, a fork's PR from a branch named
  `main` could reach production secrets.
