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
ssh ops@<ipv4> 'cloud-init status --long && findmnt /srv/data && free -h && docker version --format {{.Server.Version}} && id'
```

## Deploying the app

Every green CI run on `main` deploys automatically ([ADR-0014](../docs/adr/0014-push-based-deploys.md)).
The workflow is `.github/workflows/deploy.yml`; the server side is `deploy/deploy.sh`.

### One-time setup (after the first `tofu apply`)

```bash
cd infra

# 1. Production config on the server, with generated secrets (never leaves the server).
ssh ops@$(tofu output -raw ipv4) 'bash -s -- roundtableapp.us' < ../deploy/init-env.sh

# 2. GitHub environment that holds the deploy credentials. Deploys only from main.
gh api -X PUT repos/brianpatterson/interview-app/environments/production \
  -F 'deployment_branch_policy[protected_branches]=false' \
  -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api -X POST repos/brianpatterson/interview-app/environments/production/deployment-branch-policies \
  -f name=main -f type=branch

# 3. Deploy key and pinned host key from OpenTofu, plus non-secret settings.
tofu output -raw deploy_private_key | gh secret set DEPLOY_SSH_KEY --env production
tofu output -raw known_hosts | gh secret set DEPLOY_KNOWN_HOSTS --env production
gh variable set DEPLOY_HOST --env production --body "$(tofu output -raw ipv4)"
gh variable set DOMAIN --env production --body roundtableapp.us
```

### Everyday operations

| Task                                                       | How                                                                                                                                                                     |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy                                                     | Merge to `main`. Watch it under **Actions → Deploy**.                                                                                                                   |
| Redeploy current `main` (e.g. after replacing the droplet) | **Actions → Deploy → Run workflow**, or `gh workflow run deploy.yml`                                                                                                    |
| Roll back to an earlier release                            | Open that release's successful **Deploy** run and click **Re-run all jobs**. It redeploys exactly that SHA. Only safe if migrations since then are backward-compatible. |
| What's live?                                               | `ssh ops@<ipv4> cat /opt/interview-app/.deployed`                                                                                                                       |
| Logs                                                       | `ssh ops@<ipv4> 'cd /opt/interview-app && docker compose -f compose.prod.yml --env-file .env logs --tail 100 api'`                                                      |
| Add OAuth credentials                                      | Edit `/opt/interview-app/.env` as `ops`, then redeploy                                                                                                                  |

## Things that replace the droplet

Changing `cloud-init.yaml.tftpl`, `droplet_size`, `region` or the image **replaces** the droplet.
The reserved IP, the `/srv/data` volume (including `/opt/interview-app`: `.env` and deploy state) and the SSH host key survive. The AAAA record moves to the new
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

Past incidents and what they taught us are in [docs/incidents/](../docs/incidents/).
