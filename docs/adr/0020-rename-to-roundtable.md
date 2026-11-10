# 0020. Rename the app to Roundtable, keeping three server-level names

- **Status:** Accepted
- **Date:** 2026-11-09

## Context

The app started as "Interview App" (`interview-app`), but it lives at roundtableapp.us. The name
appeared in the UI, emails, package names, container images, infrastructure labels, the GitHub
repository and the local folder. Before registering OAuth apps (whose names users see on the
GitHub and Google consent screens), everything should say Roundtable.

Some names are wired into the running server, and renaming them isn't free.

## Options considered

1. **Rename everything, including the server.** Clean, but the data volume would have to be
   copied to a new volume (DigitalOcean can't rename one, and OpenTofu would destroy and recreate
   it), the droplet replaced (the volume path and `/opt/interview-app` are in cloud-init), and the
   Compose project restarted under a new name (a second stack competing for ports 80/443). That
   means downtime and real risk to the data, for names no user ever sees.
2. **Rename only what users see.** Quick, but leaves two names in code and docs indefinitely.
3. **Rename everything that renames in place; keep three server-level names (chosen).**

## Decision

Renamed to Roundtable / `roundtable`:

- **What users see:** the UI, the page title, email subjects and the sender name
  (`Roundtable <no-reply@mail.<domain>>`).
- **Code and images:** workspace packages (`@roundtable/api`, `@roundtable/web`,
  `@roundtable/shared`) and container images (`ghcr.io/<owner>/roundtable-{api,web}`).
- **Infrastructure labels:** the DigitalOcean project, droplet, firewall, SSH key and tags (all
  renamed in place: `tofu plan` showed 0 to add, 0 to destroy) and the Better Stack monitor.
- **The rest:** the GitHub repository (GitHub redirects old URLs), the local folder, and the docs.

Kept, documented where they're defined:

| Name                                  | Where               | Why it stays                                        |
| ------------------------------------- | ------------------- | --------------------------------------------------- |
| `interview-app-data`                  | DigitalOcean volume | Can't be renamed; a new name is a new, empty volume |
| `/opt/interview-app`                  | Server path         | Set by cloud-init; changing it replaces the droplet |
| `interview-app-prod` (`…-db-1`, etc.) | Compose project     | Renaming means a second stack and downtime          |

## Consequences

- **No downtime, no data movement.** The next deploy pulls images under the new names; the
  previous images (old names) stay on the server for rollback.
- **The old container images** (`interview-app-api`, `interview-app-web`) remain in GitHub
  Packages until deleted by hand. They cost nothing.
- **Three internal names stay old.** Anyone reading the server or `infra/` sees both names; the
  comments next to each, and this ADR, explain why.
- **Revisit when:** the droplet is replaced anyway (e.g. a size or region change). That's the
  moment to rename the server path and Compose project together, while the volume would need a
  planned copy.
