import { Context, Effect, Exit, Layer, Schema } from 'effect';
import { createDb, type Db } from '../../../apps/api/src/db/index.js';

/** A Drizzle transaction handle (the callback argument of `db.transaction`). */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Any failure from Postgres or the driver. Unexpected by definition: callers usually `orDie`. */
export class DbError extends Schema.TaggedError<DbError>()('DbError', {
  cause: Schema.Defect(),
}) {}

/**
 * Drizzle behind an Effect service. Queries stay Drizzle; this is the one place Promises become
 * Effects (the "edge"), so the rest of the app never sees a Promise from the database.
 */
export class Database extends Context.Service<
  Database,
  {
    /** Run one Drizzle query (or several, outside a transaction). */
    readonly use: <A>(query: (db: Db) => Promise<A>) => Effect.Effect<A, DbError>;
    /**
     * Run an Effect inside a Drizzle transaction. The body's typed errors come back out unchanged,
     * and any failure (typed or not) rolls the transaction back.
     */
    readonly transaction: <A, E, R>(
      body: (tx: Tx) => Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | DbError, R>;
    /** The raw Drizzle handle, for libraries that need it (Better Auth's adapter). */
    readonly drizzle: Db;
  }
>()('roundtable/Database') {
  static readonly layer = (url: string) =>
    Layer.effect(
      Database,
      Effect.gen(function* () {
        const { db, pool } = createDb(url);

        yield* Effect.addFinalizer(() => Effect.promise(() => pool.end()));

        const use = <A>(query: (db: Db) => Promise<A>) =>
          Effect.tryPromise({ try: () => query(db), catch: (cause) => new DbError({ cause }) });

        const transaction = <A, E, R>(body: (tx: Tx) => Effect.Effect<A, E, R>) =>
          Effect.gen(function* () {
            // The bridge: Drizzle wants a Promise-returning callback, so run the body as a Promise
            // with the caller's services, keep its Exit, and throw to make Drizzle roll back.
            const context = yield* Effect.context<R>();
            let bodyExit: Exit.Exit<A, E> | undefined;

            const committed = yield* Effect.tryPromise({
              try: () =>
                db.transaction(async (tx) => {
                  bodyExit = await Effect.runPromiseExitWith(context)(body(tx));

                  if (Exit.isFailure(bodyExit)) throw rollback;

                  return bodyExit.value;
                }),
              catch: (cause) => new DbError({ cause }),
            }).pipe(Effect.exit);

            // A failure from the body wins over the rollback error it caused.
            if (bodyExit && Exit.isFailure(bodyExit)) return yield* bodyExit;

            return yield* committed;
          });

        return Database.of({ use, transaction, drizzle: db });
      }),
    );
}

const rollback = new Error('rollback');
