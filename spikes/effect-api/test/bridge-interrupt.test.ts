// Does the hand-written Drizzle 0.45 bridge (src/Database.ts) roll back when interrupted?
import { assert, it } from '@effect/vitest';
import { sql } from 'drizzle-orm';
import { Effect, Exit, Fiber } from 'effect';
import { Database } from '../src/Database.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://app:app@localhost:5432/app_test';

it.live(
  'the bridge and an interrupted transaction',
  () =>
    Effect.gen(function* () {
      const db = yield* Database;
      yield* db.use((d) => d.execute(sql`drop table if exists spike_bridge_interrupt`));
      yield* db.use((d) => d.execute(sql`create table spike_bridge_interrupt (n int)`));

      const fiber = yield* db
        .transaction((tx) =>
          Effect.promise(() => tx.execute(sql`insert into spike_bridge_interrupt values (1)`)).pipe(
            Effect.andThen(Effect.never),
          ),
        )
        .pipe(Effect.forkChild);

      yield* Effect.sleep('300 millis');
      const interrupted = yield* Fiber.interrupt(fiber).pipe(
        Effect.andThen(Fiber.await(fiber)),
        Effect.timeoutOption('3 seconds'),
      );
      const rows = yield* db.use((d) => d.execute(sql`select n from spike_bridge_interrupt`));
      const openTx = yield* db.use((d) =>
        d.execute(sql`select count(*)::int as n from pg_stat_activity
                      where datname = current_database() and state = 'idle in transaction'`),
      );

      console.log(
        'BRIDGE',
        JSON.stringify({
          interruptFinished: interrupted._tag === 'Some',
          exitFailure: interrupted._tag === 'Some' && Exit.isFailure(interrupted.value),
          committedRows: rows.rows.length,
          idleInTransaction: openTx.rows[0],
        }),
      );
      assert.isTrue(true);
    }).pipe(Effect.provide(Database.layer(url))),
  { timeout: 20000 },
);
