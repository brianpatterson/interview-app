# 0013. Host on DigitalOcean instead of Hetzner; R2 for off-site storage

- **Status:** Accepted (supersedes [ADR-0012](0012-hosting-single-vps.md))
- **Date:** 2026-11-04

## Context

ADR-0012 chose Hetzner Ashburn based on published prices of roughly €5/month. Before anything was
applied, the Hetzner API showed this account **20.49/month for `cpx11` in Ashburn**, the cheapest
US type, about 4× the estimate. The budget is **$5–8/month for a US server**. Everything else in
ADR-0012 still holds: a single VPS, Docker Compose behind Caddy, OpenTofu + cloud-init, Cloudflare
DNS, a separate data volume, and a stable IP.

## Options considered (US, $5–8/month, November 2026)

| Provider        | Plan                | Specs               | Price       | OpenTofu fit                                          |
| --------------- | ------------------- | ------------------- | ----------- | ----------------------------------------------------- |
| DigitalOcean    | Basic `s-1vcpu-1gb` | 1 vCPU, 1 GB, 25 GB | $6          | Excellent: volumes, reserved IPs, firewalls, projects |
| Vultr           | Regular 1 GB        | 1 vCPU, 1 GB, 25 GB | $5          | Good                                                  |
| Akamai (Linode) | Nanode              | 1 vCPU, 1 GB, 25 GB | $5          | Good                                                  |
| OVHcloud US     | VPS-1               | 2+ vCPU, 4+ GB      | ~$6.50–7.60 | Weak: ordering VPSs through OpenTofu is clunky        |
| Hetzner US      | `cpx11`             | 2 vCPU, 2 GB        | 20.49       | Excellent, but out of budget                          |

For object storage (backups, OpenTofu state, a few MB at first): **DigitalOcean Spaces** ($5/month
flat), **Cloudflare R2** (free up to 10 GB, no download fees), **Backblaze B2** (first 10 GB free).

## Decision

- **DigitalOcean, `nyc3`, `s-1vcpu-1gb` ($6)**, with a 10 GB block volume (~$1), a reserved IPv4
  (free while assigned), a cloud firewall (free) and the free monitoring agent. Resources are
  grouped in a DigitalOcean project.
- **Cloudflare R2** for off-site storage when backups land. It's free at this size, and keeping
  backups with a different company than the server is the "off-site" part of the 3-2-1 backup
  rule.
- Total: **about $7/month** plus the domain.

## Consequences

- **1 GB of RAM is tight.** Caddy (~30 MB), the API (~120 MB) and Postgres (~150 MB) fit, with
  cloud-init's 2 GB swap as headroom. Images are built in CI, never on the server. If memory
  becomes a problem, `droplet_size = "s-1vcpu-2gb"` (~$12) is a one-line change that replaces
  the droplet; data and IP survive.
- DigitalOcean volumes have no provider-side delete protection, so `prevent_destroy` guards the
  volume in OpenTofu instead.
- The reserved IP covers IPv4 only. The AAAA record follows the droplet's own IPv6, which changes
  on replacement; the next `tofu apply` updates DNS.
- The outbound firewall must allow traffic explicitly, because DigitalOcean blocks all egress
  once a firewall is attached and has no outbound rules.
- **Lesson:** published prices from third-party sites were stale. Check the provider's console or
  API for the actual account and region before committing to a design.
