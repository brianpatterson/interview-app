import { describe, expect, it, vi } from 'vitest';
import { Schema } from 'effect';
import { resendMailer } from '../src/email.js';

describe('resendMailer', () => {
  it('posts the email to Resend with the API key', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{"id":"1"}', { status: 200 }));
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
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.lastCall ?? [];
    expect(url).toBe('https://api.resend.com/emails');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer re_test');
    expect(JSON.parse(Schema.decodeUnknownSync(Schema.String)(init?.body))).toEqual({
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
