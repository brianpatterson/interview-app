import { lt, sql } from 'drizzle-orm';
import { Cause, Context, Effect, ErrorReporter, Layer, Schema } from 'effect';
import { Database } from './db/effect.js';
import { emailSends } from './db/schema.js';
import { EmailTransport, type Email, type EmailSendFailed } from './email.js';

export interface EmailLimits {
  /** Emails of one kind (e.g. password reset) to one address in any 24 hours. */
  readonly perAddress: number;
  /** All emails in any 24 hours: keeps us inside the provider's free daily quota. */
  readonly perDay: number;
}

/**
 * Reported to Sentry when the daily limit drops an email: either an attack or real growth, and
 * either way someone should look (and maybe upgrade). One issue, which emails on first sight.
 */
export class DailyEmailLimitReached extends Schema.TaggedError<
  DailyEmailLimitReached,
  { readonly brand: unique symbol }
>()('DailyEmailLimitReached', {
  kind: Schema.Literals(['password-reset', 'verification']),
  limit: Schema.Int,
}) {
  get [ErrorReporter.attributes]() {
    return { emailKind: this.kind, limit: this.limit };
  }
}

/**
 * Sends email within the limits stored in Postgres (ADR-0018), so a script hammering "forgot
 * password" or signing up with throwaway addresses can't flood someone's inbox or burn through
 * the Resend quota. Over a limit, the email is dropped and logged; the caller isn't told, so the
 * HTTP response doesn't reveal it either (the reset endpoint always answers "if that account
 * exists, we sent a link").
 *
 * Better Auth's own rate limiter (per IP, in memory) runs first; this catches what it can't: many
 * IPs aiming at one address, and limits that must survive a restart or deploy.
 */
export class Mailer extends Context.Service<
  Mailer,
  { readonly send: (email: Email) => Effect.Effect<void, EmailSendFailed> }
>()('roundtable/Mailer') {
  static readonly layer = (limits: EmailLimits) =>
    Layer.effect(
      Mailer,
      Effect.gen(function* () {
        const db = yield* Database;
        const transport = yield* EmailTransport;

        // One transaction: an interrupted send rolls back its row and releases the lock
        // (test/database.test.ts checks the driver does that).
        const claim = (email: Email) =>
          db.transaction((tx) =>
            Effect.gen(function* () {
              const recipient = email.to.toLowerCase();

              // Serialize the check-then-insert, so concurrent requests can't all see the same
              // count and all pass. Auth emails are rare, so one lock for the table costs nothing.
              yield* tx.execute(sql`select pg_advisory_xact_lock(hashtext('email_sends'))`);
              yield* tx
                .delete(emailSends)
                .where(lt(emailSends.sentAt, sql`now() - interval '7 days'`));

              const [counts] = yield* tx
                .select({
                  total: sql<number>`count(*)::int`,
                  forAddress: sql<number>`(count(*) filter (where ${emailSends.recipient} = ${recipient} and ${emailSends.kind} = ${email.kind}))::int`,
                })
                .from(emailSends)
                .where(sql`${emailSends.sentAt} > now() - interval '24 hours'`);

              if (!counts || counts.total >= limits.perDay) return 'daily limit' as const;

              if (counts.forAddress >= limits.perAddress) return 'address limit' as const;
              // Recorded before sending: a send that then fails still counts, which errs on the
              // safe side.
              yield* tx.insert(emailSends).values({ recipient, kind: email.kind });

              return 'ok' as const;
            }),
          );

        return Mailer.of({
          send: Effect.fn('Mailer.send')(function* (email: Email) {
            // A database failure here is a defect: Better Auth gets a rejected Promise and the
            // route's reporter sees it.
            const verdict = yield* claim(email).pipe(Effect.orDie);

            if (verdict === 'daily limit') {
              yield* Effect.logError('Email not sent: daily email limit reached').pipe(
                Effect.annotateLogs({ kind: email.kind, limit: limits.perDay }),
              );
              yield* ErrorReporter.report(
                Cause.fail(new DailyEmailLimitReached({ kind: email.kind, limit: limits.perDay })),
              );

              return;
            }

            if (verdict === 'address limit') {
              yield* Effect.logWarning('Email not sent: per-address limit reached').pipe(
                Effect.annotateLogs({ kind: email.kind, limit: limits.perAddress }),
              );

              return;
            }

            // Better Auth swallows errors from email callbacks (it only console-logs them) and
            // still tells the user "check your email", so this is where a failed send shows up.
            yield* transport
              .send(email)
              .pipe(
                Effect.tapCause((cause) =>
                  Effect.logError('Email send failed', cause).pipe(
                    Effect.annotateLogs({ kind: email.kind }),
                    Effect.andThen(ErrorReporter.report(cause)),
                  ),
                ),
              );
          }),
        });
      }),
    );
}
