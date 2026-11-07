# 0011. Self-hosted authentication with Better Auth

- **Status:** Accepted (supersedes [ADR-0009](0009-defer-authentication.md))
- **Date:** 2026-11-01

## Context

The app is about to be deployed publicly, and ADR-0009 made auth a hard prerequisite. Expected
users: ~12 soon, possibly thousands. Each user's applications must be invisible to everyone else.
The learning goal favors understanding how auth works over outsourcing it.

## Options considered

1. **Managed provider (Clerk, WorkOS, Auth0)**: hosted login UI, MFA and user management. Free
   tiers cover this scale. But auth becomes a black box, user data lives with a vendor, and the
   API has to verify the vendor's JWTs.
2. **Hand-rolled sessions** (scrypt, session table, CSRF, OAuth by hand): maximum learning, and the
   highest chance of a subtle security bug in the most security-critical code.
3. **Better Auth (self-hosted library)**: open-source TypeScript. Users, sessions and accounts live
   in our Postgres through the Drizzle adapter. It implements the security-sensitive parts
   (hashing, OAuth state and PKCE, CSRF origin checks, rate limiting), and every part stays
   inspectable.
4. **Lucia**: was the go-to choice, but is now a learning resource rather than a maintained
   library.

Session strategy: **database sessions with an opaque cookie** vs. **stateless JWTs**. JWTs avoid
a database lookup per request, but can't be revoked before they expire. A primary-key lookup is
negligible at this scale, and instant revocation (sign-out, a compromised account) matters more.

## Decision

Better Auth with database sessions in `httpOnly`, `SameSite=Lax` cookies, served same-origin
under `/api/auth/*`. Sign-in methods for v1:

- **Email and password** (at least 10 characters, scrypt-hashed), with password reset by email.
- **GitHub OAuth** and **Google OAuth**, each enabled only when its client id and secret are set.
- **Account linking** by verified email, so signing in with GitHub after signing up with the same
  email reaches the same user instead of creating a duplicate.

`applications` gets a NOT NULL `user_id` foreign key (`ON DELETE CASCADE`). Every query is scoped
by the session's user, and other users' rows return 404.

## Consequences

- **Testing gotcha:** Better Auth disables its CSRF origin check when `NODE_ENV=test`. The config
  sets `advanced.disableOriginCheck: false` explicitly, and a test asserts a cross-origin
  cookie-bearing request gets 403.
- _Update 2026-11-06: [ADR-0017](0017-email-resend.md) added Resend and turned on required
  email verification._ Emails are logged rather than sent until production. The mailer is an interface (`SendEmail`),
  so swapping in Resend or Postmark touches only one file. **Email verification is not required
  yet.** Turn on `requireEmailVerification` together with the real email provider; until then,
  account linking only trusts the providers' verified emails.
- Rate limiting uses Better Auth's in-memory store, which is only active in production. That's
  correct for one API instance. Before scaling out, move it to the database or Redis.
- The migration adds `user_id NOT NULL` with no backfill. That's safe only because no
  environment had data yet. Future migrations on tables with data must backfill first, then add
  the constraint.
- Each OAuth provider needs an app registration per environment (localhost, production), with
  the callback URL `<BETTER_AUTH_URL>/api/auth/callback/<provider>`.
