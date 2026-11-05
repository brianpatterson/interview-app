#!/usr/bin/env bash
# Deploys a pair of images on the production server and rolls back if they aren't healthy.
#   Usage: deploy.sh <api-image> <web-image>
# Runs as the `deploy` user from /opt/interview-app (on the data volume), next to compose.prod.yml
# and .env. The deploy workflow copies this script and the compose file there on every deploy.
set -euo pipefail
cd "$(dirname "$0")"

api_image=$1
web_image=$2
set -a
# shellcheck disable=SC1091
source .env # DOMAIN, secrets
set +a

compose() { docker compose -f compose.prod.yml --env-file .env "$@"; }

# Starts a pair of images: migrate runs first (compose dependency), then api, then web.
start() {
  API_IMAGE=$1 WEB_IMAGE=$2 compose up -d --remove-orphans
}

# Healthy = migrations exited 0 and the public URL answers with the database up.
healthy() {
  local curl_opts=(-fsS --max-time 5)
  [ "$DOMAIN" = localhost ] && curl_opts+=(-k) # local rehearsal uses Caddy's internal CA
  for _ in $(seq 1 45); do
    migrate_exit=$(compose ps -a migrate --format '{{.ExitCode}}' 2>/dev/null || true)
    if [ -n "$migrate_exit" ] && [ "$migrate_exit" != 0 ] && [ "$(compose ps -a migrate --format '{{.State}}')" = exited ]; then
      echo "✗ migrations failed (exit $migrate_exit):"
      compose logs --tail 30 migrate
      return 1
    fi
    if curl "${curl_opts[@]}" "https://$DOMAIN/api/health" 2>/dev/null | grep -q '"db":"up"'; then
      return 0
    fi
    sleep 2
  done
  echo "✗ https://$DOMAIN/api/health not healthy after 90s"
  compose logs --tail 30 api
  return 1
}

previous=$(cat .deployed 2>/dev/null || true)

if [ -z "${SKIP_PULL:-}" ]; then # SKIP_PULL=1: local rehearsal with locally built images
  echo "→ Pulling $api_image and $web_image"
  API_IMAGE=$api_image WEB_IMAGE=$web_image compose pull --quiet api web
fi

echo "→ Starting"
if start "$api_image" "$web_image" && healthy; then
  echo "$api_image $web_image" >.deployed
  docker image prune -f >/dev/null # dangling layers only; tagged previous images stay for rollback
  echo "✓ Deployed $api_image"
  exit 0
fi

echo "✗ Deploy of $api_image failed. Recent logs:"
compose logs --tail 20 migrate api 2>&1 || true

if [ -n "$previous" ]; then
  echo "→ Rolling back to: $previous"
  read -r prev_api prev_web <<<"$previous"
  if start "$prev_api" "$prev_web" && healthy; then
    echo "✓ Rolled back. Production is on the previous version; this deploy failed."
  else
    echo "✗ Rollback also failed. Production needs attention."
  fi
else
  echo "✗ First deploy failed and there is nothing to roll back to."
fi
exit 1
