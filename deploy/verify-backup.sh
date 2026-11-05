#!/usr/bin/env bash
# Proves a backup can be restored: decrypts it, restores it into a throwaway Postgres 17, and
# checks the schema and data are there. Run nightly by .github/workflows/backup.yml on the backup
# it just uploaded, and usable by hand before a real restore.
#
# Usage: AGE_IDENTITY_FILE=<age private key file> verify-backup.sh <backup.dump.age>
# Prints a Markdown summary on stdout; progress and errors go to stderr.
set -euo pipefail

backup=${1:?usage: verify-backup.sh <backup.dump.age>}
identity=${AGE_IDENTITY_FILE:?set AGE_IDENTITY_FILE to the age private key file}
expected_migrations=${EXPECTED_MIGRATIONS:-}  # optional: fail unless exactly this many applied

name="verify-backup-$$"
workdir=$(mktemp -d)
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  rm -rf "$workdir"
}
trap cleanup EXIT

log() { printf '%s\n' "$*" >&2; }
psql_q() { docker exec "$name" psql -U postgres -d restore -v ON_ERROR_STOP=1 -Atc "$1"; }

log "Decrypting $(basename "$backup")"
age --decrypt --identity "$identity" --output "$workdir/app.dump" "$backup"

log "Starting a throwaway Postgres 17"
docker run -d --name "$name" -e POSTGRES_PASSWORD=verify -e POSTGRES_DB=restore postgres:17 >/dev/null
for _ in $(seq 1 30); do
  docker exec "$name" pg_isready -U postgres -d restore >/dev/null 2>&1 && break
  sleep 1
done
# pg_isready can succeed during the image's init restart; a real query confirms it's up.
for _ in $(seq 1 30); do psql_q 'select 1' >/dev/null 2>&1 && break; sleep 1; done

log "Restoring"
# Owners and grants refer to the production role, which doesn't exist here.
docker exec -i "$name" pg_restore -U postgres -d restore --no-owner --no-privileges \
  --exit-on-error --single-transaction <"$workdir/app.dump"

log "Checking"
migrations=$(psql_q 'select count(*) from drizzle.__drizzle_migrations')
if [[ "$migrations" -lt 1 ]]; then
  log "✗ No migrations recorded: this isn't an app database"
  exit 1
fi
if [[ -n "$expected_migrations" && "$migrations" != "$expected_migrations" ]]; then
  log "✗ $migrations migrations restored, expected $expected_migrations"
  exit 1
fi
for table in users accounts sessions applications; do
  psql_q "select 1 from public.$table limit 1" >/dev/null # fails if the table is missing
done

size=$(wc -c <"$backup" | tr -d ' ')
cat <<SUMMARY
| Check | Result |
| --- | --- |
| Backup | \`$(basename "$backup")\` ($((size / 1024)) KiB encrypted) |
| Decrypt + restore into Postgres 17 | ✅ |
| Migrations applied | $migrations |
| Users | $(psql_q 'select count(*) from public.users') |
| Applications | $(psql_q 'select count(*) from public.applications') |
| Newest application change | $(psql_q "select coalesce(max(updated_at)::text, 'none') from public.applications") |
SUMMARY
log "✓ Backup restores cleanly"
