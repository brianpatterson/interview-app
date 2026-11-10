import { lt, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from './db/index.js';
import { emailSends } from './db/schema.js';
import type { SendEmail } from './email.js';
import { Sentry } from './error-tracking.js';

export interface EmailLimits {
  /** Emails of one kind (e.g. password reset) to one address in any 24 hours. */
  perAddress: number;
  /** All emails in any 24 hours: keeps us inside the provider's free daily quota. */
  perDay: number;
}

/**
 * Wraps a mailer with sending limits stored in Postgres (ADR-0018), so a script hammering "forgot
 * password" or signing up with throwaway addresses can't flood someone's inbox or burn through
 * the Resend quota. Over a limit, the email is dropped and logged; the caller isn't told, so the
 * HTTP response doesn't reveal it either (the reset endpoint always answers "if that account
 * exists, we sent a link").
 *
 * Better Auth's own rate limiter (per IP, in memory) runs first; this catches what it can't: many
 * IPs aiming at one address, and limits that must survive a restart or deploy.
 */
export function limitedMailer(
  db: Db,
  send: SendEmail,
  limits: EmailLimits,
  log: Pick<FastifyBaseLogger, 'warn' | 'error'>,
): SendEmail {
  return async (email) => {
    const recipient = email.to.toLowerCase();

    const verdict = await db.transaction(async (tx) => {
      // Serialize the check-then-insert, so concurrent requests can't all see the same count and
      // all pass. Auth emails are rare, so one lock for the whole table costs nothing.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('email_sends'))`);
      await tx.delete(emailSends).where(lt(emailSends.sentAt, sql`now() - interval '7 days'`));

      const [counts] = await tx
        .select({
          total: sql<number>`count(*)::int`,
          forAddress: sql<number>`(count(*) filter (where ${emailSends.recipient} = ${recipient} and ${emailSends.kind} = ${email.kind}))::int`,
        })
        .from(emailSends)
        .where(sql`${emailSends.sentAt} > now() - interval '24 hours'`);

      if (counts!.total >= limits.perDay) return 'daily limit' as const;

      if (counts!.forAddress >= limits.perAddress) return 'address limit' as const;
      // Recorded before sending: a send that then fails still counts, which errs on the safe side.
      await tx.insert(emailSends).values({ recipient, kind: email.kind });

      return 'ok' as const;
    });

    if (verdict === 'daily limit') {
      // Either an attack or real growth. Either way someone should look (and maybe upgrade).
      log.error(
        { kind: email.kind, limit: limits.perDay },
        'Email not sent: daily email limit reached',
      );
      // Grouped into one Sentry issue, which emails on the first occurrence.
      Sentry.captureMessage('Daily email limit reached', {
        level: 'error',
        extra: { kind: email.kind, limit: limits.perDay },
      });

      return;
    }

    if (verdict === 'address limit') {
      log.warn(
        { kind: email.kind, limit: limits.perAddress },
        'Email not sent: per-address limit reached',
      );

      return;
    }

    try {
      await send(email);
    } catch (error) {
      // Better Auth swallows errors from email callbacks (it only console-logs them) and still
      // tells the user "check your email", so this is the one place a failed send is visible.
      log.error({ err: error, kind: email.kind }, 'Email send failed');
      Sentry.captureException(error, { tags: { emailKind: email.kind } });
      throw error;
    }
  };
}
