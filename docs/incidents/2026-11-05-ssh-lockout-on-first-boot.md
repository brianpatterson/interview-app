# 2026-11-05: Locked out of the new droplet on first boot

**Impact:** none to users (nothing was deployed yet). About 30 minutes of setup time.
**Status:** resolved by renaming the login user and recreating the droplet.

## What happened

1. `tofu apply` created the droplet, volume, IP, firewall and DNS successfully.
2. `ssh admin@161.35.249.87` failed with `Permission denied (publickey)`, as did root (expected,
   since root login is disabled).
3. Through DigitalOcean's Recovery Console: `id admin` returned **no such user**. cloud-init
   reported `0 failures`, and the rest of the config (volume mount, SSH hardening) had applied.
4. `/var/log/cloud-init.log` contained
   `useradd: group admin exists - if you want to add this user to that group, use -g`.

## Root cause

DigitalOcean's Ubuntu 24.04 image ships a group named `admin`; the stock `ubuntu:24.04` image
used for local testing does not. `useradd admin` refuses to create a user whose name matches an
existing group. cloud-init logged the error but **didn't count it as a module failure**, so
nothing reported it.

## Why the checks didn't catch it

- `cloud-init schema` validates _shape_, not _behavior_.
- The local container test used a different base image than the provider's.

## What changed

- The login user is now `ops`.
- `infra/test-cloud-init.sh` (run in CI) renders the template the way OpenTofu does and runs
  cloud-init's users step in Ubuntu 24.04 **with an `admin` group pre-created**, asserting that
  `ops` and `deploy` exist with their keys and sudo rights. The old config fails this test.
- cloud-init also removes DigitalOcean's automatic `/mnt/interview_app_data` mount, so the
  volume is mounted only once, at `/srv/data` (found while debugging).

## Lessons

- "0 failures" from a tool isn't proof of the outcome. Verify the outcome itself (can I log in?).
- Test against the real target as early as possible; a local stand-in differs in ways you won't
  guess.
- Keep an out-of-band way in (the Recovery Console) and know how to use it before you need it.
