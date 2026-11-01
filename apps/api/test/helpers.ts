import { sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { createDb } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import type { Email } from '../src/email.js';
import { loadEnv } from '../src/env.js';

export const env = loadEnv({
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://app:app@localhost:5432/app_test',
  BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  BETTER_AUTH_URL: 'http://localhost:5173',
});

export function setupTestApp() {
  const { db, pool } = createDb(env.DATABASE_URL);
  const sentEmails: Email[] = [];
  const app = buildApp(db, env, {
    logger: false,
    sendEmail: async (email) => {
      sentEmails.push(email);
    },
  });

  return {
    app,
    db,
    sentEmails,
    migrate: () => runMigrations(db),
    reset: async () => {
      sentEmails.length = 0;
      await db.execute(sql`truncate table applications, sessions, accounts, verifications, users`);
    },
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

export type TestApp = ReturnType<typeof setupTestApp>;

/** Signs up a new user through the real auth endpoint and returns their session cookie. */
export async function signUp(
  { app }: TestApp,
  email = `user-${crypto.randomUUID()}@example.com`,
  password = 'correct horse battery',
) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { origin: env.BETTER_AUTH_URL },
    payload: { email, password, name: 'Test User' },
  });
  if (res.statusCode !== 200) throw new Error(`sign-up failed: ${res.statusCode} ${res.body}`);
  const cookie = res.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  return { email, password, cookie, user: res.json<{ user: { id: string } }>().user };
}
