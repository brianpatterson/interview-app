# 0001. Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-10-28

## Context

This project exists partly to learn systems design and be able to explain it in interviews.
Decisions made in chat or in one's head are forgotten, and nobody can review them.

## Options considered

1. **No formal record**: rely on commit messages and memory. Cheap, but the "why" gets lost.
2. **Wiki or Notion page**: easy to edit, but it lives apart from the code and drifts out of date.
3. **ADRs in the repo** (Michael Nygard's format): one Markdown file per decision, reviewed in
   PRs alongside the code it explains.

## Decision

Keep ADRs in `docs/adr/`, a living `docs/architecture.md` for the current state, and
`docs/dependencies.md` for every dependency and its alternative. Docs change in the same PR as
the code, which `CLAUDE.md` and the PR template enforce, and CI checks for the dependency
register.

## Consequences

- Every significant change carries a small writing cost.
- The repo itself becomes the interview prep: "walk me through your architecture" →
  `architecture.md`; "why did you choose X?" → the ADR.
