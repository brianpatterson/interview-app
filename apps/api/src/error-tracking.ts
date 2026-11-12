import * as Sentry from '@sentry/node';
import { Cause, Effect, ErrorReporter, Layer } from 'effect';
import type { Env } from './env.js';
import { causeChain, describeError, postgresFields, redactQueryParams } from './redact.js';

/**
 * Error tracking with Sentry (ADR-0019): unexpected errors (5xx, crashes in auth, failed email
 * sends) become grouped issues with stack traces, and Sentry emails when a new one appears.
 * Errors only: no performance tracing, no request bodies, no cookies or IPs.
 *
 * Without SENTRY_DSN (development, tests) nothing is initialized, and every Sentry call
 * elsewhere in the code is a no-op.
 */
export function initErrorTracking(env: Env, overrides: Partial<Sentry.NodeOptions> = {}) {
  if (!env.SENTRY_DSN) return false;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV ?? 'development',
    release: env.SENTRY_RELEASE,
    // v11's defaults collect cookies, bodies, query strings and local variables (minus values
    // Sentry recognizes as secrets). We send stack traces and a few harmless headers only.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: {
        request: { allow: ['user-agent', 'content-type', 'origin'] },
        response: false,
      },
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
    },
    // No breadcrumbs from console.*: libraries (Better Auth) console.error whole error objects,
    // query parameters included. Our own logs go through pino, not the console.
    integrations: (defaults) => defaults.filter((integration) => integration.name !== 'Console'),
    beforeSend: scrubEvent,
    ...overrides,
  });

  return true;
}

/**
 * Second line of defence, in case an integration attaches more than `dataCollection` allows.
 * Removes secrets that can ride along in a request: query strings carry one-time tokens
 * (`/verify-email?token=…`, which signs the holder in), and headers can carry cookies.
 */
export function scrubEvent<T extends Sentry.ErrorEvent>(event: T, hint?: Sentry.EventHint): T {
  const request = event.request;

  if (request) {
    if (request.url) request.url = request.url.split('?')[0];
    delete request.query_string;
    delete request.cookies;
    delete request.data;

    if (request.headers) {
      for (const name of Object.keys(request.headers)) {
        if (/^(cookie|authorization|x-forwarded-for)$/i.test(name)) delete request.headers[name];
      }
    }
  }

  // Database query parameters can be credentials (see redact.ts). With the original error at
  // hand, each exception in the chain is matched to its error and gets the values' shapes;
  // anything unmatched still loses its values.
  const original = hint?.originalException instanceof Error ? hint.originalException : undefined;

  const described = new Map(
    (original ? causeChain(original) : []).map((e) => [e.message, describeError(e).message]),
  );

  for (const exception of event.exception?.values ?? []) {
    if (exception.value) {
      exception.value = described.get(exception.value) ?? redactQueryParams(exception.value);
    }
  }

  const postgres = original && postgresFields(original);

  if (postgres) event.contexts = { ...event.contexts, postgres };

  for (const breadcrumb of event.breadcrumbs ?? []) {
    if (breadcrumb.message) breadcrumb.message = redactQueryParams(breadcrumb.message);
  }

  return event;
}

/**
 * Sends the failures Effect reports (defects and unhandled errors at the HTTP boundary) to Sentry.
 * ErrorReporter.make already skips errors marked `ErrorReporter.ignore` (expected 401/404s), so
 * only unexpected failures arrive here; scrubEvent then runs on each one like on any other event.
 * Our own instead of @sentry/effect (alpha): this is all of it we use.
 */
const reporterLayer = ErrorReporter.layer(
  [
    ErrorReporter.make(({ cause, error }) => {
      // The original failure, not Effect's pretty-printed copy: scrubEvent matches each
      // exception in the chain to its original error to show query values as kinds.
      const original = Cause.squash(cause);

      Sentry.captureException(original instanceof Error ? original : error, { level: 'error' });
    }),
  ],
  { mergeWithExisting: true },
);

export const SentryErrorReporter = Layer.unwrap(
  // Checked when the layer is built, i.e. after initErrorTracking (production with a DSN, tests).
  Effect.sync(() => (Sentry.getClient() ? reporterLayer : Layer.empty)),
);

export { Sentry };
