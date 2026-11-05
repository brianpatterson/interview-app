# 0015. Back up nightly with encrypted pg_dump to R2, and restore-test every backup

- **Status:** Accepted
- **Date:** 2026-11-05

## Context

Production has real data on one DigitalOcean volume. That volume survives droplet replacement,
but not a deleted volume, a corrupted database, a bad migration, a mistaken `DELETE`, or losing
the DigitalOcean account. We need copies somewhere else, and proof that they restore.

The trade-offs in backup design are usually stated as two numbers:

- **RPO (recovery point objective):** how much recent data you can afford to lose.
- **RTO (recovery time objective):** how long recovery can take.

For a job tracker with a handful of users, losing up to a day of edits and being down for 15
minutes are acceptable. Cost should stay at about $0.

## Options considered

1. **DigitalOcean droplet backups or volume snapshots.** One click, but they stay inside
   DigitalOcean (not off-site), cost 20% of the droplet or $0.06/GB-month, and a
   filesystem-level copy of a running Postgres is only crash-consistent.
2. **Continuous WAL archiving (pgBackRest, WAL-G).** Point-in-time recovery with an RPO of
   minutes. More moving parts on the server (archive command, base backups, retention), and
   overkill for this data.
3. **Managed Postgres.** Backups and PITR included, from about $15/month. That's twice the
   whole budget.
4. **Nightly `pg_dump` to R2 (chosen).** A logical, consistent snapshot. It's small (KB to MB
   here), portable across Postgres versions and easy to inspect, and R2's free tier covers it.

Where the job runs:

- **A cron job or systemd timer on the server.** The server would hold an R2 write credential,
  and installing it means changing cloud-init, which replaces the droplet. Failures are silent
  unless we add alerting.
- **A scheduled GitHub Actions workflow (chosen).** The dump streams over the existing SSH
  access, and encryption and upload happen on the runner, so **the server holds no new
  credentials**. Every run has a log and a summary, and a failure emails us.

## Decision

- **Schedule:** a scheduled workflow (`.github/workflows/backup.yml`) runs every night.
- **Dump:** it runs `pg_dump --format=custom` inside the production database container over SSH.
- **Encryption:** the dump is encrypted with [age](https://age-encryption.org) to a public key.
  The plaintext exists only in a pipe.
- **Storage:** the encrypted file goes to an R2 bucket created by OpenTofu.
- **Retention:** R2 deletes objects after **30 days**. A **bucket lock** makes each object
  undeletable and unchangeable for its first **7 days**.
- **Restore test:** every run then downloads the copy it just uploaded and restores it into a
  throwaway Postgres 17 with `deploy/verify-backup.sh`. The run fails unless the restored
  migration count equals the live database's.
- **No overlap with deploys:** the backup shares the deploy's concurrency group, so it never
  runs during a deploy or migration.

Targets: **RPO 24 hours, RTO about 15 minutes**, with the restore procedure in
[infra/README.md](../../infra/README.md).

## Consequences

- **"A backup you haven't restored isn't a backup."** Every backup is restored before the run
  goes green, so a broken dump, a lost key or an unreadable upload fails within a day, not
  during an incident.
- **Encryption protects the copies in R2.** If the R2 token or the Cloudflare account leaks,
  the backups are still unreadable. The age private key is in the `backups` GitHub environment,
  for the restore test, and in a password manager. GitHub can already reach production
  (deploys run as a user with Docker access), so keeping the key there doesn't widen who can
  read the data. Losing both copies of the key makes every backup useless.
- **The bucket lock limits the damage from a leaked upload token** or a buggy script. They
  can't delete the last week of backups.
- **Dependence on GitHub.** GitHub disables scheduled workflows in public repos after 60 days
  without activity, and scheduled runs can start late at busy times. An external "dead man's
  switch" that alerts when no backup arrives belongs to the observability work.
- **The backup job uses the deploy key, which has full Docker access.** A key limited to
  `pg_dump` (an SSH forced command) would be tighter. That needs a cloud-init change, so it
  waits for the next planned droplet replacement.
- **A queued deploy and a queued backup can cancel each other's _pending_ run** (GitHub keeps
  one pending run per concurrency group). A running job is never cancelled. A skipped backup
  is retried the next night, or by running the workflow by hand.
- **Revisit when:** the data matters enough that a day's loss hurts (→ WAL archiving and PITR),
  the database grows past a few GB (→ physical backups), or we move to managed Postgres.
