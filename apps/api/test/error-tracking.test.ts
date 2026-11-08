import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ErrorEvent } from '@sentry/node';
import { initErrorTracking, scrubEvent, Sentry } from '../src/error-tracking.js';
import { env, setupTestApp, signUp } from './helpers.js';

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
    } as ErrorEvent);
    expect(event.request).toEqual({
      url: 'https://example.com/api/auth/verify-email',
      headers: { 'user-agent': 'test' },
    });
  });
});

describe('error reporting', () => {
  const events: ErrorEvent[] = [];
  beforeAll(() => {
    initErrorTracking(
      { ...env, SENTRY_DSN: 'https://public@o0.ingest.sentry.io/0' },
      {
        // Capture instead of sending anywhere.
        beforeSend: (event) => {
          events.push(scrubEvent(event));
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
    setupTestApp({}, async () => {
      throw new Error('Resend is down');
    });

  it('reports a failed email send, which Better Auth itself swallows', async () => {
    const t = failing();
    await t.migrate();
    await t.reset();
    const res = await t.app.inject({
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

  it('reports a crash in one of our own routes', async () => {
    const t = setupTestApp();
    t.app.get('/api/boom', async () => {
      throw new Error('route exploded');
    });
    const res = await t.app.inject({ method: 'GET', url: '/api/boom?token=leak' });
    expect(res.statusCode).toBe(500);
    await Sentry.flush(2000);
    const event = events.find((e) => e.exception?.values?.[0]?.value === 'route exploded');
    expect(event).toBeDefined();
    // (Not the whole event: it includes this file's source lines as context, which say 'leak'.)
    expect(JSON.stringify(event!.request ?? {})).not.toContain('leak');
    await t.close();
  });

  it('does not report expected errors like a wrong password', async () => {
    const t = setupTestApp();
    await t.migrate();
    await t.reset();
    const { email } = await signUp(t);
    const res = await t.app.inject({
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
