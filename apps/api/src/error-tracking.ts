import * as Sentry from '@sentry/node';
import type { Env } from './env.js';

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
export function scrubEvent<T extends Sentry.ErrorEvent>(event: T): T {
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

  return event;
}

export { Sentry };
