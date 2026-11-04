# Infrastructure

OpenTofu configuration for production: one Hetzner server, a data volume, static IPs, a
firewall, and Cloudflare DNS. Why it looks like this:
[ADR-0012](../docs/adr/0012-hosting-single-vps.md).

## Prerequisites

1. `brew install opentofu`
2. An SSH key: `ssh-keygen -t ed25519` (use a passphrase). Its `.pub` goes on the server.
3. `cp terraform.tfvars.example terraform.tfvars` and fill it in:
   - `hcloud_token`: Hetzner Console → project → Security → API tokens (Read & Write)
   - `cloudflare_api_token`: Cloudflare → My Profile → API Tokens → "Edit zone DNS", limited to
     this zone
   - `cloudflare_zone_id`: Cloudflare → the domain → Overview, right-hand column
   - `domain`

`terraform.tfvars` and `terraform.tfstate` hold secrets and are git-ignored. Back up the state
file (for example in your password manager) until it moves to a remote backend.

## Create or update the infrastructure

```bash
cd infra
tofu init
tofu plan    # read it: what will be created, changed, or destroyed?
tofu apply
```

The outputs show the IPs and the SSH command. cloud-init takes 2–4 minutes after the server is
created. To check:

```bash
ssh admin@<ipv4> 'cloud-init status --wait && df -h /srv/data && docker version --format {{.Server.Version}}'
```

## Things that replace the server

Changing `cloud-init.yaml.tftpl`, `server_type` or the image **replaces** the server. The IPs and
the `/srv/data` volume survive and reattach. `tofu plan` says "must be replaced" when this will
happen. Afterwards, redeploy the app.

## Runbook

| Situation                | Do this                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Server is unreachable    | Hetzner Console → server → Console (out-of-band) and check status; or `tofu apply -replace=hcloud_server.app` |
| Disk full on `/srv/data` | Raise `data_volume_size`, `tofu apply`, then `sudo resize2fs <device>` on the server                          |
| Need more CPU or RAM     | Change `server_type`, `tofu apply` (replaces the server; a few minutes of downtime)                           |
| Rotate the Hetzner token | Create a new token, update `terraform.tfvars`, delete the old token                                           |
| Tear everything down     | `tofu destroy`. The volume has delete protection, so remove it in the Hetzner Console on purpose              |
