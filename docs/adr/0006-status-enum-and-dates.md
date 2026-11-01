# 0006. Status as a Postgres enum; creation date as application date

- **Status:** Accepted
- **Date:** 2026-10-28

## Context

Each application has a status from a small, slowly changing set, plus "applied on" and "last
updated" dates.

## Options considered

For status:

1. **Free text**: flexible, but invites typos, and nothing is enforced in the database.
2. **Text with a CHECK constraint**: easy to change, and the constraint has to be kept in sync
   by hand.
3. **Lookup table** (`statuses`): the most flexible (users could add their own), but one more
   join and table.
4. **Postgres enum**: enforced by the database, compact, and the values are generated from the
   same TS array the API validates against.

For dates: a separate `applied_on` column vs. reusing `created_at`.

## Decision

A Postgres enum `application_status` generated from `APPLICATION_STATUSES` in
`packages/shared`. `created_at` serves as the application date, and `updated_at` is bumped by
the ORM on every update.

## Consequences

- Adding a status is a migration (`ALTER TYPE … ADD VALUE`). Removing or renaming one is
  painful. If users need custom statuses, move to a lookup table.
- You can't backdate an application you submitted before you started tracking it. Add an
  `applied_on` column if that turns out to matter.
- `updated_at` only records the latest change. Status history needs an events table
  (see architecture.md §8).
