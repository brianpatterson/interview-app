#!/usr/bin/env bash
# One-time setup of /opt/interview-app/.env on the server, with freshly generated secrets.
#   ssh ops@<server> 'bash -s' < deploy/init-env.sh <domain>
# Refuses to overwrite an existing .env (that would orphan the database password).
set -euo pipefail
domain=${1:?usage: init-env.sh <domain>}
env_file=/opt/interview-app/.env

if [ -e "$env_file" ]; then
  echo "$env_file already exists; not overwriting. Edit it by hand if needed."
  exit 1
fi

umask 027
cat >"$env_file" <<ENV
DOMAIN=$domain
DATA_DIR=/srv/data
POSTGRES_PASSWORD=$(openssl rand -hex 24)
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
# Resend API key with sending access to mail.$domain (required; see infra/README.md, Email)
RESEND_API_KEY=
# Sentry project DSN (optional; see infra/README.md, Monitoring)
SENTRY_DSN=
# OAuth apps registered for https://$domain (optional). Callback: https://$domain/api/auth/callback/<provider>
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
ENV
chgrp docker "$env_file" # readable by the deploy user (docker group), not by others
echo "✓ Wrote $env_file (mode $(stat -c %a "$env_file"), group docker)"
