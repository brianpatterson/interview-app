import { sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { createDb } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import type { Email } from '../src/email.js';
import { loadEnv, type Env } from '../src/env.js';

export const env = loadEnv({
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://app:app@localhost:5432/app_test',
  BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  BETTER_AUTH_URL: 'http://localhost:5173',
});

export function setupTestApp(overrides: Partial<Env> = {}) {
  const { db, pool } = createDb(env.DATABASE_URL);
  const sentEmails: Email[] = [];
  const app = buildApp(
    db,
    { ...env, ...overrides },
    {
      logger: false,
      sendEmail: async (email) => {
        sentEmails.push(email);
      },
    },
  );

  return {
    app,
    db,
    sentEmails,
    migrate: () => runMigrations(db),
    reset: async () => {
      sentEmails.length = 0;
      await db.execute(
        sql`truncate table applications, sessions, accounts, verifications, users, email_sends`,
      );
    },
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

export type TestApp = ReturnType<typeof setupTestApp>;

/** Finds (and removes) the most recent email sent to `to` whose subject contains `subject`. */
export function takeEmail(t: TestApp, to: string, subject: string): Email {
  const index = t.sentEmails.findLastIndex((e) => e.to === to && e.subject.includes(subject));
  if (index === -1) throw new Error(`no "${subject}" email to ${to}`);
  return t.sentEmails.splice(index, 1)[0]!;
}

/** The link in an email, as a path the test app can `inject` (the email has the public origin). */
export function linkPath(email: Email): string {
  const match = email.text.match(/https?:\/\/\S+/);
  if (!match) throw new Error(`no link in email: ${email.text}`);
  const url = new URL(match[0]);
  return url.pathname + url.search;
}

/** Signs up through the real endpoint without verifying the email. No session yet. */
export async function signUpUnverified(
  t: TestApp,
  email = `user-${crypto.randomUUID()}@example.com`,
  password = 'correct horse battery',
) {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { origin: env.BETTER_AUTH_URL },
    payload: { email, password, name: 'Test User' },
  });
  if (res.statusCode !== 200) throw new Error(`sign-up failed: ${res.statusCode} ${res.body}`);
  return { email, password, res };
}

/**
 * Signs up a new user, clicks the verification link like a real user, and returns the session
 * cookie that verification sets.
 */
export async function signUp(t: TestApp, email?: string, password?: string) {
  const signedUp = await signUpUnverified(t, email, password);
  const verify = await t.app.inject({
    method: 'GET',
    url: linkPath(takeEmail(t, signedUp.email, 'Confirm your email')),
  });
  if (verify.statusCode !== 302) {
    throw new Error(`verification failed: ${verify.statusCode} ${verify.body}`);
  }
  const cookie = verify.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  if (!cookie.includes('session_token')) throw new Error('verification did not sign in');
  const session = await t.app.inject({
    method: 'GET',
    url: '/api/auth/get-session',
    headers: { cookie },
  });
  return {
    email: signedUp.email,
    password: signedUp.password,
    cookie,
    user: session.json<{ user: { id: string } }>().user,
  };
}
