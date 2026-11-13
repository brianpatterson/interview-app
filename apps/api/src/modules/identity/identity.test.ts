import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Application } from '@roundtable/contract';
import { env, linkPath, setupTestApp, signUp, signUpUnverified, takeEmail } from '#test/helpers';

/** As it arrives on the wire (dates as strings). */
type ApplicationJson = typeof Application.Encoded;

const t = setupTestApp();

beforeAll(() => t.migrate());

beforeEach(() => t.reset());

afterAll(() => t.close());

describe('authentication', () => {
  it('rejects application requests without a session', async () => {
    for (const [method, url] of [
      ['GET', '/api/applications'],
      ['POST', '/api/applications'],
      ['GET', '/api/applications/00000000-0000-4000-8000-000000000000'],
      ['PATCH', '/api/applications/00000000-0000-4000-8000-000000000000'],
      ['DELETE', '/api/applications/00000000-0000-4000-8000-000000000000'],
    ] as const) {
      const res = await t.inject({ method, url, payload: {} });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('rejects a forged session cookie', async () => {
    const res = await t.inject({
      method: 'GET',
      url: '/api/applications',
      headers: { cookie: 'better-auth.session_token=forged.value' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('signs in with email and password', async () => {
    const { email, password } = await signUp(t);

    const res = await t.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: env.BETTER_AUTH_URL },
      payload: { email, password },
    });

    expect(res.statusCode).toBe(200);
    expect(res.cookies.some((c) => c.name.endsWith('session_token') && c.httpOnly)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const { email } = await signUp(t);

    const res = await t.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: env.BETTER_AUTH_URL },
      payload: { email, password: 'wrong password here' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('rejects a cookie-authenticated request from an untrusted origin (CSRF)', async () => {
    // A cross-site attacker can make the browser attach the victim's cookie, but not fake Origin.
    const { cookie } = await signUp(t);

    const res = await t.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { cookie, origin: 'https://evil.example' },
      payload: {},
    });

    expect(res.statusCode).toBe(403);
  });

  it('sends a password reset link', async () => {
    const { email } = await signUp(t);

    const res = await t.inject({
      method: 'POST',
      url: '/api/auth/request-password-reset',
      headers: { origin: env.BETTER_AUTH_URL },
      payload: { email, redirectTo: '/reset-password' },
    });

    expect(res.statusCode).toBe(200);
    expect(takeEmail(t, email, 'Reset your').text).toContain('/reset-password');
  });

  it('signs out other devices after a password reset', async () => {
    const { email, cookie } = await signUp(t);
    await t.inject({
      method: 'POST',
      url: '/api/auth/request-password-reset',
      headers: { origin: env.BETTER_AUTH_URL },
      payload: { email, redirectTo: '/reset-password' },
    });

    const token = new URL(
      takeEmail(t, email, 'Reset your').text.match(/https?:\/\/\S+/)![0],
    ).pathname
      .split('/')
      .pop();

    const reset = await t.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      headers: { origin: env.BETTER_AUTH_URL },
      payload: { token, newPassword: 'a brand new password' },
    });

    expect(reset.statusCode).toBe(200);
    const res = await t.inject({ method: 'GET', url: '/api/applications', headers: { cookie } });
    expect(res.statusCode).toBe(401);
  });
});

describe('email verification', () => {
  it('emails a link on sign-up and does not sign in until it is clicked', async () => {
    const { email, res } = await signUpUnverified(t);
    expect(res.cookies.some((c) => c.name.endsWith('session_token'))).toBe(false);
    expect(takeEmail(t, email, 'Confirm your email').text).toContain(
      '/api/auth/verify-email?token=',
    );
  });

  it('refuses an unverified sign-in and sends a fresh link', async () => {
    const { email, password } = await signUpUnverified(t);
    takeEmail(t, email, 'Confirm your email');

    const res = await t.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: env.BETTER_AUTH_URL },
      payload: { email, password },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json<{ code: string }>().code).toBe('EMAIL_NOT_VERIFIED');
    expect(takeEmail(t, email, 'Confirm your email')).toBeDefined();
  });

  it('signs in and redirects home when the link is clicked', async () => {
    const { email } = await signUpUnverified(t);

    const res = await t.inject({
      method: 'GET',
      url: linkPath(takeEmail(t, email, 'Confirm your email')),
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/');
    expect(res.cookies.some((c) => c.name.endsWith('session_token') && c.httpOnly)).toBe(true);
  });

  it('redirects with an error for a bad link', async () => {
    const res = await t.inject({
      method: 'GET',
      url: '/api/auth/verify-email?token=not-a-real-token&callbackURL=%2F',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toMatch(/^\/\?error=/);
    expect(res.cookies.some((c) => c.name.endsWith('session_token'))).toBe(false);
  });
});

describe('per-user data', () => {
  it("keeps each user's applications private", async () => {
    const alice = await signUp(t);
    const bob = await signUp(t);

    const created = await t.inject({
      method: 'POST',
      url: '/api/applications',
      headers: { cookie: alice.cookie },
      payload: { company: 'Alice Co', jobTitle: 'SWE' },
    });

    const { id } = created.json<ApplicationJson>();

    const bobList = await t.inject({
      method: 'GET',
      url: '/api/applications',
      headers: { cookie: bob.cookie },
    });

    expect(bobList.json()).toEqual([]);

    for (const method of ['GET', 'PATCH', 'DELETE'] as const) {
      const res = await t.inject({
        method,
        url: `/api/applications/${id}`,
        headers: { cookie: bob.cookie },
        payload: method === 'PATCH' ? { status: 'rejected' } : undefined,
      });

      expect(res.statusCode, method).toBe(404);
    }

    const aliceView = await t.inject({
      method: 'GET',
      url: `/api/applications/${id}`,
      headers: { cookie: alice.cookie },
    });

    expect(aliceView.json<ApplicationJson>().status).toBe('applied');
  });
});
