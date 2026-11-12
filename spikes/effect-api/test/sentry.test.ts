// What would Sentry actually receive when the database is down? Uses the real @sentry/effect
// layer with a dummy DSN; beforeSend captures each event and returns null, so nothing is sent.
import * as Sentry from '@sentry/effect/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Layer } from 'effect';
import { HttpRouter, HttpServer } from 'effect/http';
import { sql } from 'drizzle-orm';
import { createDb } from '../../../apps/api/src/db/index.js';
import { runMigrations } from '../../../apps/api/src/db/migrate.js';
import type { Email } from '../../../apps/api/src/email.js';

type ErrorEvent = Sentry.ErrorEvent;
import { loadEnv } from '../../../apps/api/src/env.js';
import { makeRoutes } from '../src/Server.js';

const env = loadEnv({
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://app:app@localhost:5432/app_test',
  BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  BETTER_AUTH_URL: 'http://localhost:5173',
});

const events: ErrorEvent[] = [];
const SentryLive = Sentry.effectLayer({
  dsn: 'https://public@o0.ingest.sentry.io/0',
  beforeSend: (event) => {
    events.push(event);
    return null;
  },
});

// The same app twice: one with a working database (to sign up and get a real session cookie),
// one whose database is unreachable and reports to Sentry.
const sentEmails: Email[] = [];
const working = HttpRouter.toWebHandler(
  makeRoutes(env, async (e) => {
    sentEmails.push(e);
  }).pipe(Layer.provide(HttpServer.layerServices)),
  { disableLogger: true },
);
const broken = HttpRouter.toWebHandler(
  makeRoutes({ ...env, DATABASE_URL: 'postgres://app:app@localhost:1/nowhere' }, async () => {}).pipe(
    Layer.provide(HttpServer.layerServices),
    Layer.provide(SentryLive),
  ),
  { disableLogger: true },
);
const admin = createDb(env.DATABASE_URL);

beforeAll(async () => {
  await runMigrations(admin.db);
  await admin.db.execute(
    sql`truncate table applications, sessions, accounts, verifications, users, email_sends`,
  );
});
afterAll(async () => {
  await working.dispose();
  await broken.dispose();
  await admin.pool.end();
});

async function sessionCookie(): Promise<string> {
  const email = `s-${crypto.randomUUID()}@example.com`;
  await working.handler(
    new Request('http://localhost/api/auth/sign-up/email', {
      method: 'POST',
      headers: { origin: env.BETTER_AUTH_URL, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'correct horse battery', name: 'S' }),
    }),
  );
  const link = sentEmails.find((e) => e.to === email)?.text.match(/https?:\/\/\S+/)?.[0];

  if (!link) throw new Error('no verification email');
  const { pathname, search } = new URL(link);
  const verify = await working.handler(
    new Request(`http://localhost${pathname}${search}`, { redirect: 'manual' }),
  );

  return verify.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

/** The parts of an event a person reads in Sentry: each exception in the chain, top frames. */
const summarize = (event: ErrorEvent) =>
  (event.exception?.values ?? []).map((e) => ({
    type: e.type,
    value: e.value,
    mechanism: e.mechanism?.type,
    topFrames: (e.stacktrace?.frames ?? [])
      .slice(-3)
      .reverse()
      .map((f) => `${f.function ?? '?'} (${(f.filename ?? '').split('node_modules/').pop()}:${f.lineno})`),
  }));

describe('Sentry event for a database outage', () => {
  it('shows what reaches Sentry', async () => {
    const cookie = await sessionCookie();
    const res = await broken.handler(
      new Request('http://localhost/api/applications', { headers: { cookie } }),
    );
    await Sentry.flush(2000);

    console.log(JSON.stringify({ status: res.status, events: events.map(summarize) }, null, 2));
    expect(res.status).toBe(500);
    expect(events.length).toBeGreaterThan(0);
  });
});
