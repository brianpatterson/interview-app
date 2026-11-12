import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ErrorEvent } from '@sentry/node';
import { initErrorTracking, scrubEvent, Sentry } from '../src/error-tracking.js';
import { redactQueryParams } from '../src/redact.js';
import { users } from '../src/db/schema.js';
import { env, setupTestApp, signUp } from './helpers.js';

const DEAD_DATABASE = 'postgres://app:app@localhost:1/nowhere';

describe('scrubEvent', () => {
  it('drops query strings, cookies, bodies and identifying headers', () => {
    const event = scrubEvent({
      type: undefined,
      request: {
        url: 'https://example.com/api/auth/verify-email?token=secret',
        query_string: 'token=secret',
        cookies: { session: 'x' },
        data: '{"password":"hunter2"}',
        headers: { Cookie: 'a=b', authorization: 'Bearer x', 'user-agent': 'test' },
      },
    });

    expect(event.request).toEqual({
      url: 'https://example.com/api/auth/verify-email',
      headers: { 'user-agent': 'test' },
    });
  });
});

describe('redactQueryParams', () => {
  it("drops a Drizzle error's parameter values but keeps the SQL and the stack", () => {
    const stack =
      'Error: Failed query: select * from "sessions" where "token" = $1\n' +
      'params: secret-token,other\n' +
      '    at NodePgPreparedQuery.queryWithCache (session.js:41:11)';

    expect(redactQueryParams(stack)).toBe(
      'Error: Failed query: select * from "sessions" where "token" = $1\n' +
        'params: <redacted>\n' +
        '    at NodePgPreparedQuery.queryWithCache (session.js:41:11)',
    );
    expect(redactQueryParams('Failed query: select 1\nparams: a\nb')).toBe(
      'Failed query: select 1\nparams: <redacted>',
    );
    expect(redactQueryParams('some other error')).toBe('some other error');
    // Already described (by the logger or scrubEvent): left alone.
    expect(redactQueryParams('Failed query: select 1\nparams: <redacted: uuid>')).toBe(
      'Failed query: select 1\nparams: <redacted: uuid>',
    );
  });
});

describe('error reporting', () => {
  const events: ErrorEvent[] = [];
  beforeAll(() => {
    initErrorTracking(
      { ...env, SENTRY_DSN: 'https://public@o0.ingest.sentry.io/0' },
      {
        // Capture instead of sending anywhere.
        beforeSend: (event, hint) => {
          events.push(scrubEvent(event, hint));

          return null;
        },
      },
    );
  });
  afterEach(() => {
    events.length = 0;
  });
  afterAll(() => Sentry.close());

  // Built after init, so the app registers Sentry's Fastify error handler.
  const failing = () =>
    setupTestApp({
      sendEmail: async () => {
        throw new Error('Resend is down');
      },
    });

  it('reports a failed email send, which Better Auth itself swallows', async () => {
    const t = failing();
    await t.migrate();
    await t.reset();

    const res = await t.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email?token=leak',
      headers: { origin: env.BETTER_AUTH_URL },
      payload: { email: 'x@example.com', password: 'correct horse battery', name: 'X' },
    });

    // Better Auth still answers 200 ("check your email"): the failure is only visible in Sentry.
    expect(res.statusCode).toBe(200);
    await Sentry.flush(2000);
    expect(events.map((e) => e.exception?.values?.[0]?.value)).toContain('Resend is down');
    await t.close();
  });

  it('reports a crash in one of our own routes, without the query string', async () => {
    const t = setupTestApp({ crashRoute: true });
    const res = await t.inject({ method: 'GET', url: '/api/test-crash?token=leak' });

    expect(res.statusCode).toBe(500);
    await Sentry.flush(2000);
    const event = events.find((e) => e.exception?.values?.[0]?.value === 'route exploded');

    expect(event).toBeDefined();
    // (Not the whole event: it includes this file's source lines as context, which say 'leak'.)
    expect(JSON.stringify(event!.request ?? {})).not.toContain('leak');
    await t.close();
  });

  it('keeps query parameters, like a session token, out of database errors', async () => {
    // Sign up on the working database to get a real session cookie.
    const t = setupTestApp();
    await t.migrate();
    await t.reset();
    const { cookie } = await signUp(t);
    const token = decodeURIComponent(cookie.match(/session_token=([^;.]+)/)?.[1] ?? '');
    expect(token).not.toBe('');

    // Same request against an unreachable database: Better Auth's session lookup fails, and
    // Drizzle's error message ends with the query's parameters (here, the raw token).
    const broken = setupTestApp({ databaseUrl: DEAD_DATABASE });

    const res = await broken.inject({
      method: 'GET',
      url: '/api/applications',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(500);
    await Sentry.flush(2000);

    const event = events.find((e) =>
      e.exception?.values?.some((v) => v.value?.startsWith('Failed query:')),
    );

    expect(event).toBeDefined();
    expect(JSON.stringify(event)).not.toContain(token);
    expect(JSON.stringify(event)).toContain(`params: <redacted: string(${token.length})>`);
    // The SQL itself stays: it's what tells you which query failed.
    expect(JSON.stringify(event)).toContain('from \\"sessions\\"');
    await broken.close();
    await t.close();
  });

  it("adds Postgres's diagnostic fields to a database error, without its values", async () => {
    const t = setupTestApp();
    await t.migrate();
    await t.reset();
    const email = `dup-${crypto.randomUUID()}@example.com`;
    const row = { id: crypto.randomUUID(), name: 'Dup', email };
    await t.db.insert(users).values(row);

    const err = await t.db
      .insert(users)
      .values({ ...row, id: crypto.randomUUID() })
      .then(
        () => undefined,
        (error: Error) => error,
      );

    Sentry.captureException(err);
    await Sentry.flush(2000);
    const event = events.find((e) => e.contexts?.postgres);
    expect(event?.contexts?.postgres).toMatchObject({
      code: '23505',
      table: 'users',
      constraint: 'users_email_unique',
    });
    expect(JSON.stringify(event)).not.toContain(email);
    await t.close();
  });

  it('does not report expected errors like a wrong password', async () => {
    const t = setupTestApp();
    await t.migrate();
    await t.reset();
    const { email } = await signUp(t);

    const res = await t.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: env.BETTER_AUTH_URL },
      payload: { email, password: 'wrong password here' },
    });

    expect(res.statusCode).toBe(401);
    await Sentry.flush(2000);
    expect(events).toHaveLength(0);
    await t.close();
  });
});
