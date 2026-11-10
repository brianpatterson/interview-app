# 0021. Lint with Oxlint only, including the anti-slop rules

- **Status:** Accepted
- **Date:** 2026-11-10

## Context

Most code here is written by coding agents. They fall into recognisable habits that type-check
and pass ordinary lint rules: casting through `as unknown as`, `unknown` parameters that skip
parsing at the boundary, conditional `...(x ? {...} : {})` spreads, quadratic reducers, module
mocking, dense unbroken statement blocks. `dmmulroy/anti-slop` ships 18 lint rules that target
exactly these, plus an agent skill (`.claude/skills/install-anti-slop/`) that installs and
updates them.

The rules are Oxlint JS plugins. Until now the repo linted with ESLint: `@eslint/js` recommended,
typescript-eslint recommended (not type-checked) and `eslint-plugin-react-hooks` recommended,
which in v7 includes the React Compiler checks.

## Options considered

1. **Oxlint only.** Replace ESLint with Oxlint's own versions of the same rules, and run the
   anti-slop rules in it. One tool and one config. Cons: Oxlint's React hooks rules are a
   rewrite rather than Meta's plugin, so edge cases and new upstream rules may lag.
2. **Oxlint next to ESLint, for the anti-slop rules only.** Nothing existing changes. Cons: two
   linters and two configs doing overlapping work.
3. **Port the anti-slop rules to ESLint.** One linter. Cons: we'd own a fork of 18 rules and
   the skill's update path no longer applies.
4. **typescript-eslint `strict-type-checked` alone.** No new tool. Cons: covers few of these
   habits (nothing for spacing, `SAFETY:` comments, object-spread omission or reducers).

## Evidence

Before deciding, we compared the two linters rule by rule (2026-11-10, Oxlint 1.93.0):

- ESLint's resolved config enabled 103 rules across TS, JS and web files. Oxlint has its own
  version of 99 of them. The other four: `react-hooks/config` and `react-hooks/gating` validate
  React Compiler settings we don't use; `no-dupe-args` and `no-octal` are syntax errors in ES
  modules, which Oxlint's parser rejects.
- On 101 files with one planted mistake each, Oxlint caught every one ESLint caught: 95 with
  the same rule, 5 as parse errors (illegal in ES modules anyway). One,
  `preserve-manual-memoization`, couldn't be triggered in either linter.
- On the real codebase both reported nothing beyond the anti-slop findings.
- A bare rule name can silently resolve to another plugin's rule (`no-namespace` matched
  `import/no-namespace`, which wasn't on). With the plugin prefix, an unknown name fails the run.

## Decision

Option 1. `.oxlintrc.json` turns Oxlint's default categories off and lists every rule
explicitly, always with its plugin prefix: the ports of our former ESLint rules, the anti-slop
rules and `oxc/no-accumulating-spread`, all at `error`. ESLint and its four companion packages
are removed. The plugin is vendored at `tools/oxlint/anti-slop/` with its provenance in
`UPSTREAM.md`; Oxlint and Prettier ignore that directory.

## Consequences

- Every type assertion needs a `// SAFETY:` comment stating the checked invariant, external input
  is parsed (Zod, from `packages/shared`) before it reaches a function, and statement blocks get
  blank lines between groups. `pnpm lint:fix` applies the spacing autofix.
- `oxlint` and `@oxlint/plugins` are pinned to the same exact version and upgraded together.
- TypeScript was pinned to `~6.0` only because of typescript-eslint, so a TS 7 upgrade is now
  unblocked.
- The vendored rules are ours: changing one is a normal PR, recorded under "Local deviations" in
  `UPSTREAM.md`. Upstream updates go through the skill's update procedure.
- Editors need the Oxc extension (`oxc.oxc-vscode`) instead of the ESLint one.
- Revisit if Oxlint's React rules miss something real (`eslint-plugin-react-hooks` can be loaded
  as an Oxlint jsPlugin), if we want type-aware rules Oxlint doesn't have, or if an anti-slop
  rule produces more noise than signal, in which case turn it off here with a reason rather
  than suppressing it inline.
