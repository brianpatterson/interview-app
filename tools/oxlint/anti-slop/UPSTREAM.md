# Vendored anti-slop Oxlint plugin

- **Source:** [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop), `skills/install-anti-slop/assets/anti-slop/`
- **Commit:** `13909c9e07590f5a85d93c62712259fe14a883f7` (upstream `HEAD` on 2026-11-10). The
  last commit to touch the skill directory is `d2a9aea3b896ffcb291a85f2c1301aa2543ad8c8`
  (2026-09-13). Verified with `diff -r`: this directory and `.claude/skills/install-anti-slop/`
  are byte-identical to that revision.
- **Installed with:** `node .claude/skills/install-anti-slop/scripts/install.mjs` (default
  destination, `tools/oxlint/anti-slop/`).
- **Entry point:** `index.ts`, registered as the `anti-slop` jsPlugin in `/.oxlintrc.json`.
  The opt-in Effect plugin (`effect/`) is copied but not registered: the repo doesn't depend on
  `effect`.
- **License:** MIT. `LICENSE` here is upstream's root license, added because the skill's assets
  don't ship it. `vendor/eslint-stylistic/` keeps its own license and provenance.

## Local deviations

- Added `LICENSE` (above). No rule source has been changed.

## Updating

Use the skill's update procedure (`.claude/skills/install-anti-slop/references/update.md`):
compare against a pinned upstream revision, port fixes, then update the commit above.
