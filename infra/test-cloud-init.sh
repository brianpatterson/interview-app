#!/usr/bin/env bash
# Renders cloud-init.yaml.tftpl the way OpenTofu does and runs it through Ubuntu 24.04's own
# cloud-init in a container: schema validation, then the users step on an image that (like
# DigitalOcean's) already has an `admin` group. Run from infra/ after `tofu init`.
set -euo pipefail

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

ssh-keygen -q -t ed25519 -N "" -f "$work/host" >/dev/null
cat >"$work/expr" <<EXPR
templatefile("cloud-init.yaml.tftpl", {
  admin_ssh_public_key  = "ssh-ed25519 AAAAtest ci",
  deploy_ssh_public_key = "ssh-ed25519 AAAAdeploy ci",
  host_private_key      = file("$work/host"),
  host_public_key       = trimspace(file("$work/host.pub")),
  volume_device         = "/dev/disk/by-id/scsi-0DO_Volume_interview-app-data"
})
EXPR
tr '\n' ' ' <"$work/expr" |
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
  # cloud-init must install exactly the host key OpenTofu generated.
  apt-get -qq install -y openssh-server >/dev/null 2>&1
  cloud-init single --file /seed/user-data.yaml --name ssh --frequency always >/dev/null 2>&1
  [ "$(cut -d" " -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)" = "$(cut -d" " -f1,2 /seed/host.pub)" ]
  # The fixed host key must survive YAML rendering intact.
  python3 -c "import yaml,sys; k=yaml.safe_load(open(\"/seed/user-data.yaml\"))[\"ssh_keys\"]; assert k[\"ed25519_private\"].startswith(\"-----BEGIN OPENSSH PRIVATE KEY-----\"), k; assert k[\"ed25519_public\"].startswith(\"ssh-ed25519 \")"
  echo "✓ cloud-init creates ops (sudo) and deploy with their keys, and carries the host key"
'
