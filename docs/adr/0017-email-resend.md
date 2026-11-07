# 0017. Send email through Resend from a subdomain, and require email verification

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

Until now the API wrote every email (password reset links) to its log, production included. A
user who forgot their password was stuck until an operator copied the link out of the log, and
nobody had to prove they owned the address they signed up with. That last part matters beyond
spam sign-ups: account linking ([ADR-0011](0011-authentication.md)) joins a GitHub or Google
sign-in to an existing account with the same email. If that email was never verified, someone
could sign up with a victim's address first and have the victim's later OAuth sign-in land in
their account. Better Auth guards against this, but requiring verification closes it entirely.

Sending mail that actually arrives (not in spam) needs a provider with a good sending reputation
and three DNS records: SPF, DKIM and DMARC.

## Options considered

1. **Resend (chosen).** A developer-focused HTTP API on top of Amazon SES. Free for 3,000
   emails a month (100 a day) on one domain, then $20/month. Simple domain setup, a dashboard
   showing every email and its delivery status.
2. **Postmark.** The best reputation for transactional mail, but no free plan beyond a
   100-email trial (from $15/month).
3. **Amazon SES directly.** The cheapest at volume ($0.10 per 1,000), but new accounts start in
   a sandbox that only sends to verified addresses until AWS approves a request, and it means an
   AWS account and IAM for one feature.
4. **Cloudflare Email Service.** Would keep everything on Cloudflare, but it was still in
   beta when this was decided.
5. **SMTP from the droplet.** Free, but mail from a fresh VPS IP lands in spam or is refused
   outright, and DigitalOcean blocks outbound SMTP on new accounts.

How the API talks to Resend:

- **Plain `fetch` (chosen).** Sending is one POST. No dependency to track or update.
- **The `resend` npm package.** Typed, but a dependency for a single endpoint.
- **SMTP via Nodemailer.** Provider-neutral, but a heavier dependency and a slower protocol;
  swapping providers is already a one-file change behind the `SendEmail` interface.

## Decision

- **Provider:** Resend, region us-east-1 (the droplet is in New York).
- **Sending domain:** `mail.<domain>`, From `Interview App <no-reply@mail.<domain>>`. Resend
  recommends a subdomain: its sending reputation is separate from the apex, which stays free
  for other mail later (for example a personal inbox).
- **DNS, in OpenTofu (`infra/email.tf`):** the DKIM key Resend issues, a bounce MX and SPF
  record on `send.mail.<domain>`, and a DMARC policy of `quarantine` for the whole domain.
  `quarantine` rather than the usual starting point `none`, because nothing else sends as this
  domain: anything that fails is spoofed. No `rua` (aggregate report) address, since that needs a
  mailbox to receive and read them.
- **Secret:** a Resend key with sending access to that one domain, only in the server's `.env`.
- **Fail closed:** the API refuses to start in production without `RESEND_API_KEY` and
  `EMAIL_FROM`. A deploy without them fails its health check and rolls back, instead of
  running a version where nobody can finish signing up. Development keeps logging emails.
- **Better Auth settings:**
  - `requireEmailVerification`: no session until the emailed link is clicked.
  - `sendOnSignIn`: an unverified user who signs in gets a new link, which also covers accounts
    created before this change.
  - `autoSignInAfterVerification`: the link signs the user in.
  - `revokeSessionsOnPasswordReset`: a reset signs out every other device.

## Consequences

- **Self-service recovery.** Password resets work without an operator.
- **Verified emails** make account linking safe and the user list trustworthy.
- **Sign-up has one more step,** and depends on email arriving. Resend's dashboard shows each
  email's delivery status when someone says it didn't.
- **A new external dependency on the sign-up path.** If Resend is down, new users can't finish
  signing up and nobody can reset a password. Existing sessions and sign-ins keep working.
- **Limits:** 100 emails a day on the free plan. [ADR-0018](0018-email-sending-limits.md) caps
  our own sending below that. Revisit (Pro at $20/month) if the app gets real traffic.
- **Existing accounts** were created unverified. Their current sessions keep working; on the
  next sign-in they're asked to confirm their email once.
- **Revisit when:** volume or deliverability becomes a problem (→ Postmark or SES), or a second
  kind of email (notifications, digests) needs HTML templates (→ React Email, which Resend
  supports natively).
