import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Application } from '@interview-app/shared';
import { env, setupTestApp, signUp } from './helpers.js';

const t = setupTestApp();
const { app } = t;

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
      const res = await app.inject({ method, url, payload: {} });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('rejects a forged session cookie', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/applications',
      headers: { cookie: 'better-auth.session_token=forged.value' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('signs in with email and password', async () => {
    const { email, password } = await signUp(t);
    const res = await app.inject({
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
    const res = await app.inject({
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
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { cookie, origin: 'https://evil.example' },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('sends a password reset link', async () => {
    const { email } = await signUp(t);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/request-password-reset',
      headers: { origin: env.BETTER_AUTH_URL },
      payload: { email, redirectTo: '/reset-password' },
    });
    expect(res.statusCode).toBe(200);
    expect(t.sentEmails).toHaveLength(1);
    expect(t.sentEmails[0]!.to).toBe(email);
    expect(t.sentEmails[0]!.text).toContain('/reset-password');
  });

  it("keeps each user's applications private", async () => {
    const alice = await signUp(t);
    const bob = await signUp(t);

    const created = await app.inject({
      method: 'POST',
      url: '/api/applications',
      headers: { cookie: alice.cookie },
      payload: { company: 'Alice Co', jobTitle: 'SWE' },
    });
    const { id } = created.json<Application>();

    const bobList = await app.inject({
      method: 'GET',
      url: '/api/applications',
      headers: { cookie: bob.cookie },
    });
    expect(bobList.json()).toEqual([]);

    for (const method of ['GET', 'PATCH', 'DELETE'] as const) {
      const res = await app.inject({
        method,
        url: `/api/applications/${id}`,
        headers: { cookie: bob.cookie },
        payload: method === 'PATCH' ? { status: 'rejected' } : undefined,
      });
      expect(res.statusCode, method).toBe(404);
    }

    const aliceView = await app.inject({
      method: 'GET',
      url: `/api/applications/${id}`,
      headers: { cookie: alice.cookie },
    });
    expect(aliceView.json<Application>().status).toBe('applied');
  });
});
