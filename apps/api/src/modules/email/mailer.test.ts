import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { emailSends } from './schema.js';
import { env, setupTestApp, signUp, type TestApp } from '#test/helpers';

function requestReset(t: TestApp, email: string) {
  return t.inject({
    method: 'POST',
    url: '/api/auth/request-password-reset',
    headers: { origin: env.BETTER_AUTH_URL },
    payload: { email, redirectTo: '/reset-password' },
  });
}

const resetsTo = (t: TestApp, email: string) =>
  t.sentEmails.filter((e) => e.to === email && e.kind === 'password-reset').length;

describe('email limits', () => {
  const t = setupTestApp();
  beforeAll(() => t.migrate());
  beforeEach(() => t.reset());
  afterAll(() => t.close());

  it('sends at most 3 password resets to one address a day, without telling the requester', async () => {
    const { email } = await signUp(t);

    for (let i = 0; i < 5; i++) {
      expect((await requestReset(t, email)).statusCode).toBe(200);
    }

    expect(resetsTo(t, email)).toBe(3);
  });

  it('counts each kind separately', async () => {
    // signUp already used one verification email for this address.
    const { email } = await signUp(t);

    for (let i = 0; i < 3; i++) await requestReset(t, email);
    expect(resetsTo(t, email)).toBe(3);
  });

  it('forgets sends older than 24 hours', async () => {
    const { email } = await signUp(t);
    const longAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await t.db.insert(emailSends).values(
      Array.from({ length: 3 }, () => ({
        recipient: email,
        kind: 'password-reset',
        sentAt: longAgo,
      })),
    );
    await requestReset(t, email);
    expect(resetsTo(t, email)).toBe(1);
  });
});

describe('daily email limit', () => {
  const t = setupTestApp({ env: { EMAIL_LIMIT_PER_DAY: 3 } });
  beforeAll(() => t.migrate());
  beforeEach(() => t.reset());
  afterAll(() => t.close());

  it('stops all email once the daily total is reached', async () => {
    const alice = await signUp(t); // 1 (verification)
    const bob = await signUp(t); // 2
    await requestReset(t, alice.email); // 3
    await requestReset(t, bob.email); // over the limit: dropped
    expect(resetsTo(t, alice.email)).toBe(1);
    expect(resetsTo(t, bob.email)).toBe(0);
  });
});

describe('limit logging', () => {
  const lines: string[] = [];
  const t = setupTestApp({ logStream: { write: (line) => void lines.push(line) } });

  beforeAll(() => t.migrate());
  beforeEach(() => t.reset());
  afterAll(() => t.close());

  it('logs a dropped email through pino, with the kind and limit but not the address', async () => {
    const { email } = await signUp(t);

    for (let i = 0; i < 4; i++) await requestReset(t, email);

    const dropped = lines.filter((line) => line.includes('per-address limit reached'));

    expect(dropped).toHaveLength(1);
    expect(JSON.parse(dropped[0]!)).toMatchObject({ kind: 'password-reset', limit: 3 });
    expect(dropped[0]).not.toContain(email);
  });
});
