#!/usr/bin/env bash
# Effect diagnostics (@effect/tsgo) for every project that uses Effect: mistakes stock tsc can't
# see, such as an Effect that is never run. Extra arguments (e.g. `--format github-actions` in CI)
# are passed to each run.
set -euo pipefail
cd "$(dirname "$0")/.."

for project in apps/api packages/shared; do
  effect-tsgo diagnostics --project "$project/tsconfig.json" --strict "$@"
done
