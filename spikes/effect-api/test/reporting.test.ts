// Which failures reach an ErrorReporter (what @sentry/effect's layer registers)? Today's API
// reports unexpected errors only (5xx), never 4xx. This records what Effect's HTTP boundary sends.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { ErrorReporter, Layer } from 'effect';
import { HttpRouter, HttpServer } from 'effect/http';
import { createDb } from '../../../apps/api/src/db/index.js';
import { runMigrations } from '../../../apps/api/src/db/migrate.js';
import type { Email } from '../../../apps/api/src/email.js';
import { loadEnv } from '../../../apps/api/src/env.js';
import { makeRoutes } from '../src/Server.js';

const env = loadEnv({
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://app:app@localhost:5432/app_test',
  BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  BETTER_AUTH_URL: 'http://localhost:5173',
});

const reported: { tag: string; severity: string; message: string }[] = [];
const Recorder = ErrorReporter.layer([
  ErrorReporter.make(({ error, severity }) => {
    reported.push({ tag: (error as { _tag?: string })._tag ?? error.name, severity, message: error.message });
  }),
]);

const sentEmails: Email[] = [];
const webHandler = (databaseUrl: string) =>
  HttpRouter.toWebHandler(
    makeRoutes({ ...env, DATABASE_URL: databaseUrl }, async (e) => {
      sentEmails.push(e);
    }).pipe(Layer.provide(HttpServer.layerServices), Layer.provide(Recorder)),
    { disableLogger: true },
  );

const good = webHandler(env.DATABASE_URL);
// Same app, database unreachable: every query fails, so authenticated routes crash (a defect).
const broken = webHandler('postgres://app:app@localhost:1/nowhere');
const admin = createDb(env.DATABASE_URL);

beforeAll(async () => {
  await runMigrations(admin.db);
  await admin.db.execute(sql`truncate table applications, sessions, accounts, verifications, users, email_sends`);
});
afterAll(async () => {
  await good.dispose();
  await broken.dispose();
  await admin.pool.end();
});

const req = (h: typeof good, path: string, init?: RequestInit) =>
  h.handler(new Request(`http://localhost${path}`, init));

async function cookie(): Promise<string> {
  const email = `r-${crypto.randomUUID()}@example.com`;
  await req(good, '/api/auth/sign-up/email', {
    method: 'POST',
    headers: { origin: env.BETTER_AUTH_URL, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct horse battery', name: 'R' }),
  });
  const link = sentEmails.find((e) => e.to === email)!.text.match(/https?:\/\/\S+/)![0];
  const { pathname, search } = new URL(link);
  const verify = await req(good, pathname + search, { redirect: 'manual' });
  return verify.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

describe('what reaches the ErrorReporter', () => {
  it('records each kind of failure', async () => {
    const c = await cookie();
    const results: Record<string, number> = {};

    reported.length = 0;
    results['401 no session'] = (await req(good, '/api/applications')).status;
    const r401 = reported.splice(0);

    results['404 not found'] = (
      await req(good, '/api/applications/00000000-0000-4000-8000-000000000000', {
        method: 'PATCH',
        headers: { cookie: c, 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'offer' }),
      })
    ).status;
    const r404 = reported.splice(0);

    results['400 invalid body'] = (
      await req(good, '/api/applications', {
        method: 'POST',
        headers: { cookie: c, 'content-type': 'application/json' },
        body: JSON.stringify({ company: '' }),
      })
    ).status;
    const r400 = reported.splice(0);

    results['404 unknown route'] = (await req(good, '/api/nope')).status;
    const rRoute = reported.splice(0);

    results['500 database down'] = (await req(broken, '/api/applications', { headers: { cookie: c } })).status;
    const r500 = reported.splice(0);

    console.log(JSON.stringify({ results, r401, r404, r400, rRoute, r500 }, null, 2));
    expect(results['500 database down']).toBe(500);
  });
});
