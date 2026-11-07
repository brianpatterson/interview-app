# 0016. Keep OpenTofu state in R2, encrypted client-side

- **Status:** Accepted
- **Date:** 2026-11-05

## Context

OpenTofu's state maps the configuration to real resources. Ours also holds secrets: the deploy
key and the SSH host private key (from the `tls` provider) and resource attributes. Until now it
lived in `infra/terraform.tfstate` on one laptop, backed up by hand to a password manager. That
causes three problems:

- **Single copy.** A lost or broken laptop means OpenTofu can no longer manage the infrastructure
  until every resource is re-imported.
- **No locking.** Two runs at once (a second machine, or a future CI job running `tofu plan`)
  can corrupt it.
- **It's in the wrong place for automation.** The software factory will eventually want CI to
  run `tofu plan` on infrastructure PRs.

## Options considered

1. **Stay local, back up by hand.** Free and simple, but it has all three problems, and the
   backup is only as fresh as the last time someone remembered.
2. **HCP Terraform / Spacelift / env0.** Managed state with locking, history and a UI. Another
   account and vendor, and HCP Terraform is built for Terraform rather than OpenTofu.
3. **S3-compatible bucket on R2 (chosen).** OpenTofu's `s3` backend works with R2. The bucket
   already exists from the backups work. It locks with a lock file (conditional writes, no
   DynamoDB). Cost: $0.
4. **Postgres backend on the droplet.** Circular: the state that manages the server would live on
   that server.

On top of the remote backend, **OpenTofu's native state encryption** (since 1.7, which
Terraform doesn't have): AES-GCM with a key derived from a passphrase (PBKDF2).

## Decision

- **Backend:** the `s3` backend points at `<domain>-tofu-state` on R2, key
  `production/terraform.tfstate`, with `use_lockfile = true`.
- **Credentials:** an R2 token scoped to that one bucket, read from the
  `roundtable-tofu-state` profile in `~/.aws/credentials`. The backend block can't use
  sensitive variables, and this keeps them out of the repo directory.
- **Encryption:** state and saved plans are encrypted before upload with a key derived from
  `state_passphrase` (password manager plus `terraform.tfvars`). Plans are `enforced`, so an
  unencrypted plan file is refused.
- **Migration:** a temporary `unencrypted` fallback method reads the old local state during
  `tofu init -migrate-state`. It was removed once the migration was done, and state encryption is now `enforced`.
- **CI:** `test-cloud-init.sh` renders the template with `tofu console` in an empty directory,
  so CI never needs the backend, credentials or passphrase.

## Consequences

- **The state survives the laptop**, and a second machine (or CI later) can use it after the
  one-time setup in [infra/README.md](../../infra/README.md).
- **Defence in depth for the secrets in state.** A leaked R2 token or Cloudflare account exposes
  only ciphertext. Cloudflare can't read it either.
- **The passphrase becomes critical.** Lose it and the state is unreadable. The infrastructure
  keeps running, but OpenTofu can't manage it until everything is re-imported. Changing it
  later means a one-time migration with both the old and new keys configured.
- **No state history.** R2 has no object versioning, so a bad write overwrites the previous
  state. OpenTofu writes `errored.tfstate` locally if an upload fails, and the lock prevents
  concurrent writes. Revisit if state corruption ever happens: periodic encrypted snapshots to
  the backup bucket are cheap.
- **Every `tofu` command now needs network access to R2.**
