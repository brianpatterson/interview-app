import { assert, describe, it } from '@effect/vitest';
import { sql } from 'drizzle-orm';
import { Effect, Layer, Schema } from 'effect';
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http';
import { HttpApiClient } from 'effect/http-api';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { createDb } from '../../../apps/api/src/db/index.js';
import { runMigrations } from '../../../apps/api/src/db/migrate.js';
import { applications } from '../../../apps/api/src/db/schema.js';
import type { Email } from '../../../apps/api/src/email.js';
import { loadEnv } from '../../../apps/api/src/env.js';
import { Api } from '../src/Api.js';
import { Database } from '../src/Database.js';
import { makeWebHandler } from '../src/Server.js';

const env = loadEnv({
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://app:app@localhost:5432/app_test',
  BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  BETTER_AUTH_URL: 'http://localhost:5173',
});
const sentEmails: Email[] = [];
const { handler, dispose } = makeWebHandler(env, async (email) => {
  sentEmails.push(email);
});
const admin = createDb(env.DATABASE_URL);

beforeAll(() => runMigrations(admin.db));
beforeEach(async () => {
  sentEmails.length = 0;
  await admin.db.execute(
    sql`truncate table applications, sessions, accounts, verifications, users, email_sends`,
  );
});
afterAll(async () => {
  await dispose();
  await admin.pool.end();
});

const call = (path: string, init?: RequestInit) =>
  handler(new Request(`http://localhost${path}`, init));

/** Sign up and verify through Better Auth's real endpoints; returns the session cookie. */
async function signUp(): Promise<string> {
  const email = `user-${crypto.randomUUID()}@example.com`;
  const res = await call('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { origin: env.BETTER_AUTH_URL, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct horse battery', name: 'Test User' }),
  });

  if (res.status !== 200) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
  const link = sentEmails.find((e) => e.to === email)?.text.match(/https?:\/\/\S+/)?.[0];

  if (!link) throw new Error('no verification email');
  const { pathname, search } = new URL(link);
  const verify = await call(pathname + search, { redirect: 'manual' });
  const cookie = verify.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');

  if (!cookie.includes('session_token')) throw new Error(`verification did not sign in`);

  return cookie;
}

/** The typed client generated from the Api definition, talking to the in-memory handler. */
const clientWith = (cookie?: string) =>
  HttpApiClient.make(Api, {
    baseUrl: 'http://localhost',
    transformClient: (client) =>
      cookie ? client.pipe(HttpClient.mapRequest(HttpClientRequest.setHeader('cookie', cookie))) : client,
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.Fetch, (input, init) => call(String(input).replace('http://localhost', ''), init)),
  );

describe('Effect HttpApi spike', () => {
  it.effect('creates, lists and updates through the typed client', () =>
    Effect.gen(function* () {
      const client = yield* clientWith(yield* Effect.promise(signUp));

      // The typed client encodes its payload, so it must already satisfy the schema (trimmed).
      const created = yield* client.applications.create({
        payload: { company: 'Acme', jobTitle: 'SWE' },
      });
      assert.instanceOf(created.createdAt, Date); // decoded from the wire's ISO string

      const updated = yield* client.applications.update({
        params: { id: created.id },
        payload: { status: 'offer' },
      });
      assert.strictEqual(updated.status, 'offer');

      const list = yield* client.applications.list();
      assert.deepStrictEqual(
        list.map((a) => a.id),
        [created.id],
      );
      // The row has a userId column; the response schema doesn't, so it never leaves the server.
      assert.notProperty(list[0], 'userId');
    }),
  );

  it.effect("returns a typed 404 for another user's application", () =>
    Effect.gen(function* () {
      const alice = yield* clientWith(yield* Effect.promise(signUp));
      const bob = yield* clientWith(yield* Effect.promise(signUp));
      const theirs = yield* alice.applications.create({ payload: { company: 'A', jobTitle: 'B' } });

      const error = yield* bob.applications
        .update({ params: { id: theirs.id }, payload: { status: 'offer' } })
        .pipe(Effect.flip);
      assert.strictEqual(error._tag, 'ApplicationNotFound');
    }),
  );

  it.effect('rejects requests without a session with a typed 401', () =>
    Effect.gen(function* () {
      const anonymous = yield* clientWith();
      const error = yield* anonymous.applications.list().pipe(Effect.flip);
      assert.strictEqual(error._tag, 'Unauthorized');
    }),
  );

  it.effect('trims untrusted input on the server', () =>
    Effect.gen(function* () {
      const res = yield* Effect.promise(async () => {
        const cookie = await signUp();
        return call('/api/applications', {
          method: 'POST',
          headers: { cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ company: '  Acme  ', jobTitle: 'SWE' }),
        });
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual((yield* Effect.promise(() => res.json())).company, 'Acme');
    }),
  );

  it.effect('rejects invalid input before the handler runs', () =>
    Effect.gen(function* () {
      const res = yield* Effect.promise(async () => {
        const cookie = await signUp();
        return call('/api/applications', {
          method: 'POST',
          headers: { cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ company: '', jobTitle: 'SWE' }),
        });
      });
      assert.strictEqual(res.status, 400);
    }),
  );

  it.effect('answers health without a session', () =>
    Effect.gen(function* () {
      const health = yield* (yield* clientWith()).system.health();
      assert.deepInclude(health, { ok: true, db: 'up' });
    }),
  );
});

class Boom extends Schema.TaggedError<Boom>()('Boom', {}) {}

describe('Database.transaction bridge', () => {
  const TestDb = Database.layer(env.DATABASE_URL);
  const count = Effect.gen(function* () {
    const db = yield* Database;
    const rows = yield* db.use((d) => d.select().from(applications));
    return rows.length;
  });
  const insertThen = <E>(after: Effect.Effect<void, E>) =>
    Effect.gen(function* () {
      const db = yield* Database;
      const cookie = yield* Effect.promise(signUp);
      const user = yield* (yield* clientWith(cookie)).applications.list(); // signs up a real user
      void user;
      const [{ id: userId }] = yield* db.use((d) => d.execute<{ id: string }>(sql`select id from users limit 1`)).pipe(Effect.map((r) => r.rows as [{ id: string }]));

      return yield* db.transaction((tx) =>
        Effect.promise(() => tx.insert(applications).values({ company: 'X', jobTitle: 'Y', userId })).pipe(
          Effect.andThen(after),
        ),
      );
    });

  it.effect('commits when the body succeeds', () =>
    Effect.gen(function* () {
      yield* insertThen(Effect.void);
      assert.strictEqual(yield* count, 1);
    }).pipe(Effect.provide(TestDb)),
  );

  it.effect("rolls back and keeps the body's typed error", () =>
    Effect.gen(function* () {
      const error = yield* insertThen(Effect.fail(new Boom())).pipe(Effect.flip);
      assert.strictEqual(error._tag, 'Boom'); // not swallowed into a DbError
      assert.strictEqual(yield* count, 0);
    }).pipe(Effect.provide(TestDb)),
  );

  it.effect('rolls back on a defect too', () =>
    Effect.gen(function* () {
      const exit = yield* insertThen(Effect.die('kaboom')).pipe(Effect.exit);
      assert.isTrue(exit._tag === 'Failure');
      assert.strictEqual(yield* count, 0);
    }).pipe(Effect.provide(TestDb)),
  );
});

void Layer;
