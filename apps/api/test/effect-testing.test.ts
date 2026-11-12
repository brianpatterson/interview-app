// How @effect/vitest runs Effect tests here, written down as tests because the difference cost
// an afternoon in the Effect spike: a sleep-then-interrupt test hung under `it.effect` and looked
// like a database bug (docs/research/2026-11-effect-spike.md).
import { assert, describe, it } from '@effect/vitest';
import { Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';

describe('@effect/vitest', () => {
  it.effect('it.effect runs on a simulated clock: time only passes when the test moves it', () =>
    Effect.gen(function* () {
      const sleeper = yield* Effect.sleep('1 hour').pipe(Effect.as('woke'), Effect.forkChild);

      // Without this, the sleep would never finish and the test would time out.
      yield* TestClock.adjust('1 hour');

      assert.strictEqual(yield* Fiber.join(sleeper), 'woke');
    }),
  );

  it.live('it.live runs on the real clock: use it for anything that waits on real I/O', () =>
    Effect.gen(function* () {
      const started = Date.now();

      yield* Effect.sleep('20 millis');

      assert.isAtLeast(Date.now() - started, 15);
    }),
  );
});
