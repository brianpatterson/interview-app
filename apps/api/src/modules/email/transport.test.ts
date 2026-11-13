// The Resend transport against a scripted fetch: what it sends, and which failures it retries.
import { describe, expect, it } from 'vitest';
import { Cause, Effect, Exit, Redacted, Schedule, Schema } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { EmailSendFailed, makeResendTransport, type Email } from './transport.js';

const email: Email = { kind: 'verification', to: 'a@example.com', subject: 'Hi', text: 'Body' };

interface Sent {
  readonly url: string;
  readonly headers: Headers;
  readonly body: unknown;
}

/** Answers each request with the next response in `responses` and records what was sent. */
function scriptedFetch(responses: Array<() => Response | Promise<Response>>) {
  const sent: Sent[] = [];

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);

    sent.push({
      url: request.url,
      headers: request.headers,
      body: Schema.decodeSync(Schema.fromJsonString(Schema.Unknown))(await request.text()),
    });

    const next = responses[sent.length - 1];

    if (!next) throw new Error('no more scripted responses');

    return next();
  };

  return { fetch, sent };
}

/** What Resend answers: an email id, or an error `name` (and `message`). */
interface ResendReply {
  readonly id?: string;
  readonly name?: string;
  readonly message?: string;
}

const json = (status: number, body: ResendReply) => () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The failure a send ended with, if any. */
const failureOf = (exit: Exit.Exit<void, EmailSendFailed>) =>
  Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

/** Sends `email` through the transport, with no real waiting between retries. */
function send(fetch: typeof globalThis.fetch) {
  return Effect.runPromiseExit(
    makeResendTransport({
      apiKey: Redacted.make('re_test'),
      from: 'App <no-reply@mail.example.com>',
      retrySchedule: Schedule.spaced('1 millis'),
    }).pipe(
      Effect.flatMap((transport) => transport.send(email)),
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.Fetch, fetch),
    ),
  );
}

describe('Resend transport', () => {
  it('posts the email with the API key and an idempotency key', async () => {
    const { fetch, sent } = scriptedFetch([json(200, { id: '1' })]);

    expect(Exit.isSuccess(await send(fetch))).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe('https://api.resend.com/emails');
    expect(sent[0]?.headers.get('authorization')).toBe('Bearer re_test');
    expect(sent[0]?.headers.get('idempotency-key')).toMatch(/^verification\/[0-9a-f-]{36}$/);
    expect(sent[0]?.body).toEqual({
      from: 'App <no-reply@mail.example.com>',
      to: ['a@example.com'],
      subject: 'Hi',
      text: 'Body',
    });
  });

  it('retries a Resend outage with the same idempotency key, so it is delivered once', async () => {
    const { fetch, sent } = scriptedFetch([
      json(503, { name: 'service_unavailable' }),
      json(500, { name: 'application_error' }),
      json(200, { id: '1' }),
    ]);

    expect(Exit.isSuccess(await send(fetch))).toBe(true);
    expect(sent).toHaveLength(3);
    expect(new Set(sent.map((s) => s.headers.get('idempotency-key'))).size).toBe(1);
  });

  it('retries the per-second rate limit and a network failure', async () => {
    const { fetch, sent } = scriptedFetch([
      json(429, { name: 'rate_limit_exceeded' }),
      () => Promise.reject(new TypeError('fetch failed')),
      json(200, { id: '1' }),
    ]);

    expect(Exit.isSuccess(await send(fetch))).toBe(true);
    expect(sent).toHaveLength(3);
  });

  it('gives up after three attempts, with Resend’s reason', async () => {
    const { fetch, sent } = scriptedFetch([
      json(503, { name: 'service_unavailable' }),
      json(503, { name: 'service_unavailable' }),
      json(503, { name: 'service_unavailable' }),
    ]);

    const exit = await send(fetch);

    expect(sent).toHaveLength(3);
    const failure = failureOf(exit);

    expect(failure).toBeInstanceOf(EmailSendFailed);
    expect(failure).toMatchObject({ status: 503, retryable: true });
  });

  it.each([
    ['an unverified domain', 403, 'validation_error'],
    ['a used-up daily quota', 429, 'daily_quota_exceeded'],
    ['an invalid request', 422, 'missing_required_field'],
  ])('does not retry %s', async (_name, status, name) => {
    const { fetch, sent } = scriptedFetch([json(status, { name, message: 'domain not verified' })]);

    const exit = await send(fetch);

    expect(sent).toHaveLength(1);
    const failure = failureOf(exit);

    expect(failure).toBeInstanceOf(EmailSendFailed);
    expect(failure).toMatchObject({ status, retryable: false });
    expect(String(failure)).toContain(`HTTP ${status}`);
  });
});
