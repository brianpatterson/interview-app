# Infrastructure

OpenTofu configuration for production: one DigitalOcean droplet, a data volume, a reserved IP, a
cloud firewall, and Cloudflare DNS. Why it looks like this:
[ADR-0012](../docs/adr/0012-hosting-single-vps.md) (single VPS) and
[ADR-0013](../docs/adr/0013-digitalocean-instead-of-hetzner.md) (DigitalOcean).

## Prerequisites

1. `brew install opentofu doctl`
2. An SSH key: `ssh-keygen -t ed25519` (use a passphrase). Its `.pub` goes on the server.
3. `cp terraform.tfvars.example terraform.tfvars` and fill it in:
   - `do_token`: DigitalOcean → API → Tokens → **Generate New Token**, with an expiry and
     **custom scopes**: full access (create/read/update/delete) to `droplet`, `block_storage`,
     `block_storage_action`, `reserved_ip`, `firewall`, `ssh_key`, `project`, `tag`, and read
     access to `regions`, `sizes`, `image`, `actions`. If `tofu apply` fails with a 403 naming a
     missing scope, edit the token to add it and apply again.
   - `cloudflare_api_token`: Cloudflare → My Profile → API Tokens → "Edit zone DNS", limited to
     this zone
   - `cloudflare_zone_id`: Cloudflare → the domain → Overview, right-hand column
   - `domain`

`terraform.tfvars`, `terraform.tfstate` and saved plans (`tfplan`) hold secrets and are git-ignored. Back up the state
file (for example in your password manager) until it moves to R2.

## Create or update the infrastructure

```bash
cd infra
tofu init
tofu plan -out=tfplan    # read it: what will be created, changed, or destroyed?
tofu apply tfplan        # applies exactly what you reviewed, nothing else
```

The outputs show the IPs and the SSH command. cloud-init takes 2–4 minutes after the droplet is
created. To check:

```bash
ssh admin@<ipv4> 'cloud-init status --wait && df -h /srv/data && free -h && docker version --format {{.Server.Version}}'
```

## Things that replace the droplet

Changing `cloud-init.yaml.tftpl`, `droplet_size`, `region` or the image **replaces** the droplet.
The reserved IP and the `/srv/data` volume survive and reattach. The AAAA record moves to the new
droplet's IPv6. `tofu plan` says "must be replaced" when this will happen. Afterwards, redeploy
the app.

## Runbook

| Situation                     | Do this                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Droplet is unreachable        | DigitalOcean console → droplet → **Recovery Console** (out-of-band), check status; or `tofu apply -replace=digitalocean_droplet.app` |
| Out of memory                 | Check `free -h` and `docker stats`; then `droplet_size = "s-1vcpu-2gb"` and `tofu apply` (replaces the droplet)                      |
| Disk full on `/srv/data`      | Raise `data_volume_size`, `tofu apply`, then `sudo resize2fs /dev/disk/by-id/scsi-0DO_Volume_interview-app-data`                     |
| Rotate the DigitalOcean token | Generate a new token, update `terraform.tfvars`, revoke the old one                                                                  |
| Tear everything down          | `tofu destroy` refuses because the volume has `prevent_destroy`. Remove that line deliberately if you really mean it                 |
