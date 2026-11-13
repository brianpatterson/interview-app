import {
  Context,
  Duration,
  Effect,
  ErrorReporter,
  Layer,
  Option,
  Redacted,
  Schedule,
  Schema,
} from 'effect';
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http';
import type { Log } from '../../platform/observability/logging.js';
import type { Env } from '../../platform/config/env.js';

/** Limits are counted per kind, so verification retries never block a password reset. */
export type EmailKind = 'password-reset' | 'verification';

export type SendEmail = (email: Email) => Promise<void>;

export interface Email {
  readonly kind: EmailKind;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/**
 * An email that couldn't be sent. `retryable` says whether trying again could help (a Resend
 * outage or rate limit) or not (an unverified domain, a used-up quota).
 */
export class EmailSendFailed extends Schema.TaggedError<
  EmailSendFailed,
  { readonly brand: unique symbol }
>()('EmailSendFailed', {
  kind: Schema.Literals(['password-reset', 'verification']),
  /** Resend's HTTP status; absent when the request never got an answer. */
  status: Schema.optional(Schema.Int),
  /** Resend's error body (it names the problem and holds no secrets), or what went wrong. */
  message: Schema.String,
  retryable: Schema.Boolean,
}) {
  // Reported to Sentry with the kind, so a broken reset flow is told apart from verification.
  get [ErrorReporter.attributes]() {
    return { emailKind: this.kind, status: this.status };
  }
}

/** Delivers an email, with no limits: Resend, the log, or a test's capture. */
export class EmailTransport extends Context.Service<
  EmailTransport,
  { readonly send: (email: Email) => Effect.Effect<void, EmailSendFailed> }
>()('roundtable/EmailTransport') {
  /**
   * Development: logs the email instead of sending it, so links (password resets, email
   * verification) can be copied from the API's log.
   */
  static readonly log = (log: Pick<Log, 'info'>) =>
    Layer.succeed(EmailTransport, {
      send: (email) =>
        Effect.sync(() => log.info({ email }, `Email to ${email.to}: ${email.subject}`)),
    });

  /** From a Promise-returning function (tests capture emails, or fail, with one). */
  static readonly fromPromise = (send: SendEmail) =>
    Layer.succeed(EmailTransport, {
      send: (email) =>
        Effect.tryPromise({
          try: () => send(email),
          catch: (error) =>
            new EmailSendFailed({
              kind: email.kind,
              message: error instanceof Error ? error.message : 'Email send failed',
              retryable: false,
            }),
        }),
    });
}

/** Resend's error body: `{ name, message, statusCode }`. Only `name` is used, to decide retries. */
const ResendError = Schema.Struct({ name: Schema.String });
const readResendError = Schema.decodeUnknownOption(Schema.fromJsonString(ResendError));

/**
 * Worth retrying (Resend's error docs): their 5xx errors, the per-second rate limit, and a
 * concurrent request with the same idempotency key. Not 4xx validation errors or a used-up
 * daily/monthly quota, which fail the same way until someone acts.
 */
function isRetryable(status: number, body: string): boolean {
  if (status >= 500) return true;

  const name = Option.map(readResendError(body), (error) => error.name);

  return Option.contains(
    name,
    status === 429 ? 'rate_limit_exceeded' : 'concurrent_idempotent_requests',
  );
}

export interface ResendOptions {
  readonly apiKey: Redacted.Redacted<string>;
  readonly from: string;
  /** Between attempts. Defaults to 0.5 s then 1 s (jittered): three attempts within ~2 s. */
  readonly retrySchedule?: Schedule.Schedule<unknown, EmailSendFailed>;
}

const RESEND_URL = 'https://api.resend.com/emails';

/** Per attempt. Better Auth waits for the send before answering, so the user waits too. */
const ATTEMPT_TIMEOUT = Duration.seconds(10);

const defaultRetrySchedule = Schedule.exponential('500 millis').pipe(Schedule.jittered);

/** Retries after the first attempt: three attempts in all. */
const RETRIES = 2;

/**
 * Sends through Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email):
 * one POST, no SDK. Retries what's worth retrying (see isRetryable) with one idempotency key per
 * email, so a retry after a timeout never delivers it twice (Resend keeps keys for 24 hours).
 * Needs an HttpClient: `resendLayer` provides fetch's.
 */
export const makeResendTransport = Effect.fnUntraced(function* (options: ResendOptions) {
  const client = yield* HttpClient.HttpClient;

  const attempt = (email: Email, idempotencyKey: string) =>
    HttpClientRequest.post(RESEND_URL).pipe(
      HttpClientRequest.bearerToken(options.apiKey),
      HttpClientRequest.setHeader('Idempotency-Key', idempotencyKey),
      HttpClientRequest.bodyJsonUnsafe({
        from: options.from,
        to: [email.to],
        subject: email.subject,
        text: email.text,
      }),
      client.execute,
      Effect.flatMap((res) =>
        res.status < 300
          ? Effect.void
          : res.text.pipe(
              Effect.orElseSucceed(() => ''),
              Effect.flatMap((body) =>
                Effect.fail(
                  new EmailSendFailed({
                    kind: email.kind,
                    status: res.status,
                    message: `Resend rejected the email (HTTP ${res.status}): ${body.slice(0, 500)}`,
                    retryable: isRetryable(res.status, body),
                  }),
                ),
              ),
            ),
      ),
      Effect.timeoutOrElse({
        duration: ATTEMPT_TIMEOUT,
        orElse: () =>
          Effect.fail(
            new EmailSendFailed({ kind: email.kind, message: 'Resend timed out', retryable: true }),
          ),
      }),
      // A request that never got an answer (DNS, connection reset): retryable, and the
      // idempotency key makes it safe even if Resend did receive it.
      Effect.catchTag('HttpClientError', (error) =>
        Effect.fail(
          new EmailSendFailed({
            kind: email.kind,
            message: `Resend unreachable: ${error.message}`,
            retryable: true,
          }),
        ),
      ),
    );

  return EmailTransport.of({
    send: Effect.fn('Resend.send')(function* (email: Email) {
      const idempotencyKey = `${email.kind}/${crypto.randomUUID()}`;

      yield* attempt(email, idempotencyKey).pipe(
        Effect.retry({
          schedule: options.retrySchedule ?? defaultRetrySchedule,
          times: RETRIES,
          while: (error) => error.retryable,
        }),
      );
    }),
  });
});

/** Resend over fetch. */
export const resendLayer = (options: ResendOptions) =>
  Layer.effect(EmailTransport, makeResendTransport(options)).pipe(
    Layer.provide(FetchHttpClient.layer),
  );

/** Resend when it's configured (always in production; see env.ts), otherwise the log. */
export function transportFromEnv(env: Env, log: Pick<Log, 'info'>) {
  return env.RESEND_API_KEY && env.EMAIL_FROM
    ? resendLayer({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM })
    : EmailTransport.log(log);
}
