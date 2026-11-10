import { describe, expect, it, vi } from 'vitest';
import { resendMailer } from '../src/email.js';
import { loadEnv } from '../src/env.js';

const baseEnv = {
  DATABASE_URL: 'postgres://x',
  BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  BETTER_AUTH_URL: 'https://example.com',
};

describe('resendMailer', () => {
  it('posts the email to Resend with the API key', async () => {
    const fetchMock = vi.fn(async () => new Response('{"id":"1"}', { status: 200 }));
    await resendMailer(
      're_test',
      'App <no-reply@mail.example.com>',
      fetchMock,
    )({
      kind: 'verification',
      to: 'a@example.com',
      subject: 'Hi',
      text: 'Body',
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer re_test');
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'App <no-reply@mail.example.com>',
      to: ['a@example.com'],
      subject: 'Hi',
      text: 'Body',
    });
  });

  it('throws when Resend rejects the email', async () => {
    const fetchMock = vi.fn(
      async () => new Response('{"message":"domain not verified"}', { status: 403 }),
    );

    await expect(
      resendMailer(
        're_test',
        'x@example.com',
        fetchMock,
      )({ kind: 'verification', to: 'a@b.c', subject: 's', text: 't' }),
    ).rejects.toThrow(/HTTP 403.*domain not verified/);
  });
});

describe('loadEnv', () => {
  it('requires a real mailer in production', () => {
    expect(() => loadEnv({ ...baseEnv, NODE_ENV: 'production' })).toThrow(/RESEND_API_KEY/);
    expect(() =>
      loadEnv({ ...baseEnv, NODE_ENV: 'production', RESEND_API_KEY: '', EMAIL_FROM: '' }),
    ).toThrow(/RESEND_API_KEY/);
    expect(
      loadEnv({ ...baseEnv, NODE_ENV: 'production', RESEND_API_KEY: 're_x', EMAIL_FROM: 'a@b.c' })
        .RESEND_API_KEY,
    ).toBe('re_x');
  });

  it('allows the log mailer outside production', () => {
    expect(loadEnv(baseEnv).RESEND_API_KEY).toBeUndefined();
  });
});
