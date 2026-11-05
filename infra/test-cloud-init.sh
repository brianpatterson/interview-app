#!/usr/bin/env bash
# Renders cloud-init.yaml.tftpl the way OpenTofu does and runs it through Ubuntu 24.04's own
# cloud-init in a container: schema validation, then the users step on an image that (like
# DigitalOcean's) already has an `admin` group. Run from infra/ after `tofu init`.
set -euo pipefail

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

echo 'templatefile("cloud-init.yaml.tftpl", { admin_ssh_public_key = "ssh-ed25519 AAAAtest ci", deploy_ssh_public_key = "ssh-ed25519 AAAAdeploy ci", volume_device = "/dev/disk/by-id/scsi-0DO_Volume_interview-app-data" })' |
  tofu console |
  sed -e '1s/^<<EOT$//' -e '$s/^EOT$//' >"$work/user-data.yaml"

docker run --rm -v "$work:/seed:ro" ubuntu:24.04 bash -euc '
  export DEBIAN_FRONTEND=noninteractive
  apt-get -qq update >/dev/null
  apt-get -qq install -y cloud-init sudo >/dev/null 2>&1
  cloud-init schema --config-file /seed/user-data.yaml
  groupadd admin # present on DigitalOcean'"'"'s Ubuntu image
  cloud-init single --file /seed/user-data.yaml --name users_groups --frequency always >/dev/null 2>&1
  id ops
  grep -q "AAAAtest ci" /home/ops/.ssh/authorized_keys
  sudo -l -U ops | grep -q "NOPASSWD: ALL"
  id deploy
  grep -q "AAAAdeploy ci" /home/deploy/.ssh/authorized_keys
  echo "✓ cloud-init creates ops (sudo) and deploy with their keys"
'
