// Control: the same interruption with Effect's own SQL client and no Drizzle.
import { assert, it } from '@effect/vitest';
import { PgClient } from '@effect/sql-pg';
import { Effect, Exit, Fiber, Redacted } from 'effect';
import { SqlClient } from 'effect/sql';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://app:app@localhost:5432/app_test';

it.live('plain @effect/sql-pg rolls back an interrupted transaction', () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`drop table if exists spike_interrupt`;
    yield* sql`create table spike_interrupt (n int)`;

    const fiber = yield* sql
      .withTransaction(sql`insert into spike_interrupt values (1)`.pipe(Effect.andThen(Effect.never)))
      .pipe(Effect.forkChild);

    yield* Effect.sleep('200 millis');
    const exit = yield* Fiber.interrupt(fiber).pipe(Effect.andThen(Fiber.await(fiber)));
    const rows = yield* sql<{ n: number }>`select n from spike_interrupt`;
    yield* sql`drop table spike_interrupt`;

    assert.isTrue(Exit.isFailure(exit));
    assert.strictEqual(rows.length, 0);
  }).pipe(Effect.provide(PgClient.layer({ url: Redacted.make(url) }))),
  { timeout: 15000 },
);
