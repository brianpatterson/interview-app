// Does Drizzle 1.0's native Effect support (drizzle-orm 1.0.0-rc.5) work with Effect 4.1.3 against
// the real app_test database? Compared with the hand-written bridge in spikes/effect-api.
import { assert, describe, it } from '@effect/vitest';
import { PgClient } from '@effect/sql-pg';
import { eq, sql } from 'drizzle-orm';
import * as PgDrizzle from 'drizzle-orm/effect-postgres';
import { createSelectSchema } from 'drizzle-orm/effect-schema';
import { boolean, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { Effect, Exit, Fiber, Layer, Redacted, Schema } from 'effect';

// The two tables this test touches, redeclared with Drizzle 1.0 (apps/api is on 0.45).
const users = pgTable('users', {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
});
const status = pgEnum('application_status', [
  'applied',
  'screening',
  'interviewing',
  'offer',
  'accepted',
  'rejected',
  'withdrawn',
]);
const applications = pgTable('applications', {
  id: uuid().primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  company: text().notNull(),
  jobTitle: text('job_title').notNull(),
  jobUrl: text('job_url'),
  status: status().notNull().default('applied'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

const url = process.env.TEST_DATABASE_URL ?? 'postgres://app:app@localhost:5432/app_test';
const Db = Layer.mergeAll(PgClient.layer({ url: Redacted.make(url) }));
const makeDb = PgDrizzle.makeWithDefaults();

class Boom extends Schema.TaggedError<Boom>()('Boom', {}) {}

const reset = Effect.gen(function* () {
  const db = yield* makeDb;
  yield* db.execute(sql`truncate table applications, sessions, accounts, verifications, users, email_sends`);
  const userId = crypto.randomUUID();
  yield* db.insert(users).values({ id: userId, name: 'U', email: `${userId}@example.com` });
  return { db, userId };
});

const count = Effect.gen(function* () {
  const db = yield* makeDb;
  const rows = yield* db.select().from(applications);
  return rows.length;
});

describe('Drizzle 1.0 + Effect 4', () => {
  it.effect('queries are Effects with inferred row types', () =>
    Effect.gen(function* () {
      const { db, userId } = yield* reset;
      const [created] = yield* db
        .insert(applications)
        .values({ userId, company: 'Acme', jobTitle: 'SWE' })
        .returning();
      const rows = yield* db.select().from(applications).where(eq(applications.userId, userId));

      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0]?.id, created?.id);
      assert.instanceOf(rows[0]?.createdAt, Date);
    }).pipe(Effect.provide(Db)),
  );

  it.effect('commits a transaction', () =>
    Effect.gen(function* () {
      const { db, userId } = yield* reset;
      yield* db.transaction((tx) =>
        tx.insert(applications).values({ userId, company: 'A', jobTitle: 'B' }),
      );
      assert.strictEqual(yield* count, 1);
    }).pipe(Effect.provide(Db)),
  );

  it.effect("rolls back and keeps the body's typed error", () =>
    Effect.gen(function* () {
      const { db, userId } = yield* reset;
      const error = yield* db
        .transaction((tx) =>
          tx
            .insert(applications)
            .values({ userId, company: 'A', jobTitle: 'B' })
            .pipe(Effect.andThen(Effect.fail(new Boom()))),
        )
        .pipe(Effect.flip);

      assert.strictEqual(error._tag, 'Boom');
      assert.strictEqual(yield* count, 0);
    }).pipe(Effect.provide(Db)),
  );

  // it.live: it.effect runs on a simulated clock, where Effect.sleep never ends on its own.
  it.live('rolls back when the fiber is interrupted mid-transaction (the bridge could not)', () =>
    Effect.gen(function* () {
      const { db, userId } = yield* reset;
      const fiber = yield* db
        .transaction((tx) =>
          tx
            .insert(applications)
            .values({ userId, company: 'A', jobTitle: 'B' })
            .pipe(Effect.andThen(Effect.never)),
        )
        .pipe(Effect.forkChild);

      yield* Effect.sleep('200 millis'); // let the insert run inside the open transaction
      const exit = yield* Fiber.interrupt(fiber).pipe(Effect.andThen(Fiber.await(fiber)));

      assert.isTrue(Exit.isFailure(exit));
      assert.strictEqual(yield* count, 0);
    }).pipe(Effect.provide(Db)),
  );

  it.effect('reports a failed query as a tagged error (what does it carry?)', () =>
    Effect.gen(function* () {
      const { db } = yield* reset;
      const error = yield* db
        .select()
        .from(applications)
        .where(eq(applications.id, 'not-a-uuid'))
        .pipe(Effect.flip);

      console.log(
        'ERRORINFO',
        JSON.stringify({
          tag: error._tag,
          keys: Object.keys(error),
          params: Reflect.get(error, 'params'),
          json: JSON.parse(JSON.stringify(error)),
          causeType: error.cause instanceof Error ? error.cause.constructor.name : String(error.cause),
          causeMessage: error.cause instanceof Error ? error.cause.message : undefined,
        }),
      );
      assert.strictEqual(error._tag, 'EffectDrizzleQueryError');
    }).pipe(Effect.provide(Db)),
  );

  it.effect('generates an Effect Schema from the table', () =>
    Effect.gen(function* () {
      const { db, userId } = yield* reset;
      const [row] = yield* db
        .insert(applications)
        .values({ userId, company: 'Acme', jobTitle: 'SWE' })
        .returning();
      const ApplicationRow = createSelectSchema(applications);

      const decoded = Schema.decodeUnknownSync(ApplicationRow)(row);
      assert.strictEqual(decoded.company, 'Acme');
      const bad = Schema.decodeUnknownExit(ApplicationRow)({ ...row, status: 'ghosted' });
      assert.isTrue(Exit.isFailure(bad));
    }).pipe(Effect.provide(Db)),
  );
});
