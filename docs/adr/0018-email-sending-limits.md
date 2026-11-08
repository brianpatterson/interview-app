# 0018. Limit auth emails per IP, per address and per day

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

Two endpoints send email to an address the caller chooses, without being signed in: "forgot
password" and sign-up (plus "resend verification"). Without limits, a script can:

- **Flood one person's inbox** with reset emails. That's harassment, and their mail provider
  learns to mark our mail as spam.
- **Burn the Resend quota.** The free plan allows 100 emails a day and 3,000 a month
  ([ADR-0017](0017-email-resend.md)). Once that's gone, real users can't reset passwords or
  finish signing up, or we pay $20/month.

Better Auth already rate-limits these endpoints per IP, in memory, in production. Its default
for password resets is 3 a minute, which still allows about 4,300 a day from a single machine.
And per-IP limits don't help when requests come from many IPs, which is cheap for an attacker.

## Options considered

1. **Better Auth's per-IP limiter only, tightened.** Free and already there, but blind to
   attacks spread across IPs, and it resets on every deploy (memory).
2. **Better Auth's limiter with database storage.** Survives restarts, but it's still keyed by
   IP and path, not by recipient, and it writes a row on every auth request, not just emails.
3. **Cloudflare rate limiting rules.** Stops traffic before it reaches the server, but it needs
   the Cloudflare proxy turned on (it's off: [ADR-0013](0013-digitalocean-instead-of-hetzner.md)),
   and the free plan allows one rule keyed by IP only.
4. **A CAPTCHA (Cloudflare Turnstile) on the forms.** Makes scripting expensive, but it adds
   friction for every real user and a third-party script on the page. Worth adding if the
   limits below are being hit.
5. **Per-IP limits plus a recipient-aware limit in Postgres (chosen).**

## Decision

Two layers, in this order:

1. **Per IP (Better Auth, in memory):** 5 password-reset and 5 resend-verification requests,
   and 10 sign-ups, per IP per hour. This stops a single script cheaply, before it touches the
   database.
2. **Per address and per day (`email-limits.ts`, Postgres):** every auth email is recorded in
   `email_sends` before it's sent.
   - **Per address:** at most **3 emails of each kind** (password reset, verification) to one
     address in any 24 hours. Kinds are counted separately, so verification retries never block
     a reset.
   - **Global:** at most **80 emails in any 24 hours**, leaving 20 of Resend's 100 for manual
     sends and testing. 80 a day stays under the 3,000 monthly quota too (80 × 30 = 2,400).
   - **Over a limit:** the email is **silently dropped** and logged. The API's response doesn't
     change, so the caller can't use it to learn whether an account exists. Hitting the daily
     cap logs at `error` level, because it means either an attack or real growth.
   - **Correctness:** an advisory lock makes check-then-insert atomic, and rows older than 7 days
     are deleted. Both limits can be overridden in the server's `.env`.

## Consequences

- **The bill is capped:** the app can't send more than Resend's free plan allows, whatever
  anyone does.
- **Trade-off at the cap:** once 80 emails have gone out in a day, real users can't reset a
  password or confirm a new account until some of those age out. That's the price of a hard $0
  ceiling. The `error` log line is what tells us it happened (alerting on it belongs to the
  observability step).
- **Rough capacity:** with a few sign-ups and resets per active user per month, 80 a day serves
  roughly a few hundred active users before the cap starts to matter. That's the signal to
  upgrade Resend and raise `EMAIL_LIMIT_PER_DAY`.
- **A legitimate user who requests a 4th reset** in a day gets no email and no explanation.
  Rare, and the reset page already says "if that email has an account".
- **Revisit when:** the daily cap is hit by real traffic (→ upgrade, raise it), or by attacks
  (→ add Turnstile).
