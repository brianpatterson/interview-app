# 0009. Defer authentication; single-tenant for now

- **Status:** Accepted
- **Date:** 2026-10-28

## Context

There is one user today, about a dozen are likely soon, and possibly thousands later. Auth is
essential before anyone else uses the app, or before it's on the public internet.

## Options considered

1. **Build auth now**: slows the first slice and the first deploy.
2. **Defer it, and design the schema so adding `user_id` is a clean migration**: ship the core
   loop first.

## Decision

Defer. **Auth is a hard prerequisite for a public production deploy.** It gets its own ADR
covering session cookies vs. JWTs, and self-hosted (Better Auth/Lucia-style) vs. a managed
provider (Clerk/Auth0/WorkOS).

## Consequences

- Adding auth means adding `users`, adding a NOT NULL `applications.user_id` (backfilled with
  the first user), scoping every query by user, and changing the index to `(user_id,
updated_at)`.
- Until then, any deployed instance must be private (IP-restricted or behind basic auth).
