# 0010. Public repository with automated supply-chain and code scanning

- **Status:** Accepted
- **Date:** 2026-10-31

## Context

`main` needs protection: required CI, PR-only merges, no force pushes. GitHub only offers that on
private repos with a paid plan. The project is also a portfolio piece for interviews. With 24 npm
dependencies, plus hundreds more pulled in by them, the supply chain is the largest attack
surface.

## Options considered

1. **Stay private and pay for GitHub Pro** ($4/month): rulesets work, but CodeQL and dependency
   review would still need Advanced Security, which costs far more.
2. **Stay private and unprotected**: free, but relies on discipline, and the security scanning
   is unavailable.
3. **Go public**: rulesets, CodeQL, dependency review and secret scanning are all free, and
   interviewers can read the code, ADRs and CI history.

For scanning: **Snyk or Socket** (third-party, deeper supply-chain analysis, another account to
manage) vs. **GitHub-native tools** (Dependabot, dependency review, CodeQL: zero setup and
results in the Security tab).

## Decision

Make the repository public, and use the GitHub-native tools:

- **Dependabot**: a weekly update PR per ecosystem (npm, GitHub Actions, Docker Compose), with
  minor and patch bumps grouped together. Security updates arrive immediately. Major bumps of
  TypeScript (pinned to `~6.0`) and Postgres (which needs a data migration) are ignored and done
  deliberately.
- **Dependency review**: fails any PR that introduces a dependency with a moderate-or-worse known
  vulnerability, or a GPL/AGPL license.
- **CodeQL**: `security-extended` queries on TypeScript and the workflows themselves, on every PR
  and push to `main`, and weekly.

## Consequences

- No secrets may ever be committed. Secrets go in `.env` (git-ignored) locally and in GitHub or
  the hosting provider's secret store in production. Before going public, the git history was
  checked: the only credential is the placeholder local Postgres password `app`.
- Dependabot PRs go through the same required `check` job, so an update that breaks the build
  can't merge. A Dependabot PR that _swaps_ a package still needs `docs/dependencies.md` updated
  by hand, and `check:deps` will flag it.
- Revisit Socket or Snyk if supply-chain attacks via install scripts become a concern. pnpm
  already blocks dependency install scripts unless they're allowed in `pnpm-workspace.yaml`.
