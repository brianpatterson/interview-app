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
     this zone, plus the permission **Account → Workers R2 Storage → Edit** for your account
     (for the backup and state buckets)
   - `cloudflare_zone_id`: Cloudflare → the domain → Overview, right-hand column
   - `cloudflare_account_id`: same column, under **Account ID**
   - `domain`
   - `state_passphrase`: encrypts the state. Copy it from your password manager (see below).
4. Credentials for the state bucket, in `~/.aws/credentials` (see below).

## State

OpenTofu's state (what exists, plus the deploy and host private keys) lives in the R2 bucket
`<domain>-tofu-state`, **encrypted on your machine** with `state_passphrase` before upload
([ADR-0016](../docs/adr/0016-remote-encrypted-state.md)). A lock file in the bucket stops two
`tofu` commands from changing it at once. `terraform.tfvars` and saved plans (`tfplan`, also
encrypted) are git-ignored.

**The passphrase is the only way to read the state.** Keep it in your password manager. Lose it
and OpenTofu can no longer manage the infrastructure (it keeps running, but you'd have to
re-import every resource).

### One-time setup on a new machine

1. R2 → **Manage API tokens** → **Create Account API token**: **Object Read & Write**, applied
   to the `<domain>-tofu-state` bucket only. Copy the **Access Key ID** (32 characters) and
   **Secret Access Key** (64 characters).
2. Save them under the profile the backend uses. Paste each value at its prompt:

   ```bash
   mkdir -p ~/.aws && touch ~/.aws/credentials && chmod 600 ~/.aws/credentials
   read -r "id?Access Key ID: " && read -rs "secret?Secret Access Key: " && echo &&
     printf '\n[roundtable-tofu-state]\naws_access_key_id = %s\naws_secret_access_key = %s\n' "$id" "$secret" \
     >> ~/.aws/credentials && unset id secret
   ```

3. `state_passphrase` in `terraform.tfvars`, from your password manager, then `tofu init`.

### Moving the existing local state into R2 (done once, 2026-11)

1. Do steps 1–2 above. Generate a passphrase, save it in your password manager, and put it in
   `terraform.tfvars` as `state_passphrase`:

   ```bash
   openssl rand -base64 30
   ```

2. Pull this change, then copy the state up (answer `yes` when asked to copy it):

   ```bash
   cd infra
   tofu init -migrate-state
   tofu plan   # must say "No changes": the same infrastructure, now read from R2
   ```

3. Check the copy in R2 is encrypted: in the Cloudflare dashboard, open the bucket and download
   `production/terraform.tfstate`. It should contain an `encrypted_data` field, not readable
   resources.
4. Delete the local copies, now that R2 has the state and your password manager has the
   passphrase. Also delete the old state backup in your password manager.

   ```bash
   rm terraform.tfstate terraform.tfstate.backup
   ```

5. A follow-up PR removed the `unencrypted` migration fallback from `versions.tf`.

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

## Backups

Every night at 07:17 UTC, `.github/workflows/backup.yml` dumps the database (`pg_dump`, custom
format), encrypts it with [age](https://age-encryption.org), uploads it to the R2 bucket
`<domain>-backups`, then downloads that copy and restores it into a throwaway Postgres to prove
it works ([ADR-0015](../docs/adr/0015-backups.md)). Each run's summary shows the row counts. A
failed run emails you.

- **Retention:** 30 days, then R2 deletes them. Nothing can delete or overwrite a backup in its
  first 7 days (bucket lock).
- **Recovery point:** up to 24 hours of changes can be lost. **Recovery time:** about 15 minutes.
- **The age private key is the only way to read a backup.** It lives in your password manager and
  in the `backups` GitHub environment. Lose both and every backup is useless.

### One-time setup

1. Cloudflare dashboard → **R2** → enable it (the free plan asks for a payment method; nothing is
   charged within the free tier). Add the R2 permission to the OpenTofu token and
   `cloudflare_account_id` to `terraform.tfvars` (see Prerequisites), then `tofu plan` and
   `tofu apply` as usual. Expect 4 to add.
2. R2 → **Manage API tokens** → **Create Account API token**: permission **Object Read & Write**,
   applied to the `<domain>-backups` bucket only. Keep the page open for step 4.
3. The encryption key. `backups.agekey` holds a key pair: the public half encrypts backups, the
   private half is the **only** way to decrypt them. GitHub secrets can't be read back, so your
   own copy is what you'd restore with if GitHub were unavailable.

   ```bash
   brew install age
   age-keygen -o backups.agekey
   cat backups.agekey   # copy all three lines into a password-manager secure note
   ```

4. The `backups` GitHub environment (deploys from `main` only), from `infra/`. `gh secret set`
   without `--body` prompts for the value, so paste the two R2 values from step 2 there:

   ```bash
   gh api -X PUT repos/brianpatterson/interview-app/environments/backups \
     -F 'deployment_branch_policy[protected_branches]=false' \
     -F 'deployment_branch_policy[custom_branch_policies]=true'
   gh api -X POST repos/brianpatterson/interview-app/environments/backups/deployment-branch-policies \
     -f name=main -f type=branch
   gh secret set AGE_IDENTITY --env backups < backups.agekey
   rm backups.agekey   # only after it's in your password manager
   gh secret set R2_ACCESS_KEY_ID --env backups
   gh secret set R2_SECRET_ACCESS_KEY --env backups
   tofu output -raw deploy_private_key | gh secret set DEPLOY_SSH_KEY --env backups
   tofu output -raw known_hosts | gh secret set DEPLOY_KNOWN_HOSTS --env backups
   gh variable set DEPLOY_HOST --env backups --body "$(tofu output -raw ipv4)"
   gh variable set R2_ENDPOINT --env backups --body "$(tofu output -raw r2_endpoint)"
   gh variable set R2_BUCKET --env backups --body "$(tofu output -raw backup_bucket)"
   ```

5. Run the first backup (`gh workflow run backup.yml`) and read its summary.

### Restore production from a backup

Practice this on a local stack before you need it. You need the age key and an R2 token that can
read the bucket.

```bash
# 1. Download and check it. verify-backup.sh restores into a throwaway database, not production.
brew install awscli
export AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_DEFAULT_REGION=auto
aws s3 ls "s3://$(tofu output -raw backup_bucket)/daily/" --endpoint-url "$(tofu output -raw r2_endpoint)"
aws s3 cp "s3://$(tofu output -raw backup_bucket)/daily/<file>" app.dump.age --endpoint-url "$(tofu output -raw r2_endpoint)"
AGE_IDENTITY_FILE=backups.agekey ../deploy/verify-backup.sh app.dump.age
age -d -i backups.agekey -o app.dump app.dump.age

# 2. Stop the app, replace the database in one transaction, start the app.
scp app.dump ops@<ipv4>:/tmp/app.dump
ssh ops@<ipv4>
cd /opt/interview-app
docker compose -f compose.prod.yml --env-file .env stop web api
docker exec -i interview-app-prod-db-1 pg_restore -U app -d app --clean --if-exists \
  --no-owner --single-transaction --exit-on-error < /tmp/app.dump
docker compose -f compose.prod.yml --env-file .env start api web
shred -u /tmp/app.dump
```

Then delete `app.dump`, `app.dump.age` and any `backups.agekey` you saved from the password manager. If the restored data is from an older schema,
redeploy the release that matches it, or let the next deploy migrate it forward.

## Things that replace the droplet

Changing `cloud-init.yaml.tftpl`, `droplet_size`, `region` or the image **replaces** the droplet.
The reserved IP, the `/srv/data` volume (including `/opt/interview-app`: `.env` and deploy state) and the SSH host key survive. The AAAA record moves to the new
droplet's IPv6. `tofu plan` says "must be replaced" when this will happen. Afterwards, redeploy
the app.

## Runbook

| Situation                     | Do this                                                                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Droplet is unreachable        | DigitalOcean console → droplet → **Recovery Console** (out-of-band), check status; or `tofu apply -replace=digitalocean_droplet.app`         |
| Out of memory                 | Check `free -h` and `docker stats`; then `droplet_size = "s-1vcpu-2gb"` and `tofu apply` (replaces the droplet)                              |
| Disk full on `/srv/data`      | Raise `data_volume_size`, `tofu apply`, then `sudo resize2fs /dev/disk/by-id/scsi-0DO_Volume_interview-app-data`                             |
| Rotate the DigitalOcean token | Generate a new token, update `terraform.tfvars`, revoke the old one                                                                          |
| Backup run failed             | Open the run's log. SSH or R2 errors: check the `backups` environment secrets. Restore check failed: the backup is unusable, so fix it today |
| Tear everything down          | `tofu destroy` refuses because the volume and buckets have `prevent_destroy`. Remove those lines deliberately if you really mean it          |

Past incidents and what they taught us are in [docs/incidents/](../docs/incidents/).
