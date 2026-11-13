// What the Effect database (src/db/effect.ts) guarantees that the code relies on. The email
// limits claim a send inside one transaction that holds a table-wide lock: if an interrupted
// request left that transaction open, the connection and the lock would stay held and every
// later email would wait. The Effect spike found exactly that with a hand-written bridge
// (docs/research/2026-11-effect-spike.md); Drizzle's Effect driver rolls back instead.
import { assert, describe, it } from '@effect/vitest';
import { sql } from 'drizzle-orm';
import { Effect, Exit, Fiber } from 'effect';
import { Database } from '../src/db/effect.js';
import { emailSends } from '../src/db/schema.js';
import { env } from './helpers.js';

const recipient = `rollback-${crypto.randomUUID()}@example.com`;

const rowsFor = Effect.gen(function* () {
  const db = yield* Database;

  const rows = yield* db
    .select({ count: sql<number>`count(*)::int` })
    .from(emailSends)
    .where(sql`${emailSends.recipient} = ${recipient}`);

  return rows[0]?.count;
});

describe('Effect database transactions', () => {
  // it.live: real time, since the test waits for the insert to reach Postgres.
  it.live('roll back, and release their lock, when the fiber is interrupted', () =>
    Effect.gen(function* () {
      const db = yield* Database;

      const fiber = yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* tx.execute(sql`select pg_advisory_xact_lock(hashtext('email_sends'))`);
            yield* tx.insert(emailSends).values({ recipient, kind: 'verification' });

            return yield* Effect.never;
          }),
        )
        .pipe(Effect.forkChild);

      yield* Effect.sleep('200 millis'); // let the insert run inside the open transaction
      const exit = yield* Fiber.interrupt(fiber).pipe(Effect.andThen(Fiber.await(fiber)));

      assert.isTrue(Exit.isFailure(exit));
      assert.strictEqual(yield* rowsFor, 0);

      // The lock went with the transaction: another one can take it straight away.
      const locked = yield* db
        .transaction((tx) =>
          tx.execute(sql`select pg_try_advisory_xact_lock(hashtext('email_sends')) as ok`),
        )
        .pipe(Effect.map((result) => JSON.stringify(result)));

      assert.include(locked, 'true');
    }).pipe(Effect.provide(Database.layer(env.DATABASE_URL))),
  );
});
