# 0012. Host on a single Hetzner VPS, provisioned with OpenTofu

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

First production deploy. Users: ~12 soon, possibly thousands, mostly in the US. Learning to run
production for real (OS, TLS, database, backups, deploys) is an explicit goal, and so is low
cost. Peak load is estimated at ~30 req/s (architecture.md §2), which is trivial.

## Options considered

1. **Platform-as-a-service (Render, Railway, Fly.io)**: push to deploy, managed Postgres,
   ~$15–30/month. Fast, but hides the parts this project exists to learn.
2. **AWS (ECS Fargate + RDS + ALB), with Terraform**: very resume-relevant and highly
   available, but ~$40–60/month with many moving parts (VPC, IAM, load balancer) for one small
   app.
3. **Single VPS**: Docker Compose behind Caddy, everything defined as code. Cheap
   (~€5–10/month), and every layer is visible. The trade-off is a single point of failure.

Provider for option 3: **Hetzner** (cheapest for the specs, a solid OpenTofu provider, US
regions in Ashburn and Hillsboro) vs. **DigitalOcean** (about 2× the price, managed Postgres
available, more US regions).

Provisioning: **OpenTofu + cloud-init** (declarative, reproducible, reviewed in PRs) vs.
**Ansible** on a hand-made server (good for configuration drift, but the server itself is
clicked together) vs. **manual**.

## Decision

- **Hetzner Cloud, Ashburn (`ash`)**, one small shared-vCPU server. Postgres data and TLS
  certificates live on a separate **block volume** with delete protection. **Primary IPv4/IPv6
  addresses** are separate resources, so the server is disposable: replace it, and the IPs and
  data reattach.
- **OpenTofu** in `infra/` manages the server, volume, IPs, firewall (22/80/443 and ping only),
  SSH key and **Cloudflare DNS** (apex A/AAAA, `www` CNAME, a CAA record allowing only Let's
  Encrypt). DNS is DNS-only (not proxied) for now. **cloud-init** hardens the box: key-only SSH
  with no root login, fail2ban, unattended security upgrades with nightly reboots if needed,
  Docker log rotation, and swap.
- **Runtime**: `compose.prod.yml` runs Caddy (the web image: TLS via Let's Encrypt, SPA, security
  headers, `/api` reverse proxy), the API (an esbuild bundle on `node:26-slim`, non-root), a
  one-off `migrate` container that must succeed before the API starts, and Postgres 17 with no
  public port.

## Consequences

- **Availability**: a single server in a single datacenter. Expect roughly 99.5–99.9%. Recovery
  from a lost server is `tofu apply` plus a redeploy, about 10–15 minutes, with data intact on the
  volume. Loss of the volume itself needs off-site backups (next step on the roadmap: nightly
  `pg_dump` to object storage, plus a tested restore).
- **Scaling path**: move to a bigger server type (vertical, minutes of downtime); then managed or
  replicated Postgres on its own server; then multiple API servers behind a Hetzner load
  balancer. The API is already stateless.
- OpenTofu state is local for now and contains secrets. Move it to an S3-compatible backend
  before anyone else runs `tofu apply`.
- SSH is open to the internet because GitHub-hosted runners have no fixed IPs. It's mitigated by
  key-only auth and fail2ban. Revisit with a VPN (Tailscale) or a self-hosted runner.
- Graceful shutdown on SIGTERM keeps deploys from dropping in-flight requests. There's still a
  few seconds of downtime per API restart; zero-downtime deploys (two API replicas, rolled one at
  a time) are a later improvement.
