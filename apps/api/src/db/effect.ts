import { PgClient } from '@effect/sql-pg';
import * as PgDrizzle from 'drizzle-orm/effect-postgres';
import { Context, Effect, Layer, Redacted } from 'effect';

// Drizzle's Effect driver on Effect's own Postgres client (ADR-0022): queries and transactions
// are Effects, so an interrupted request rolls its transaction back. Better Auth, the email
// limits and migrations keep the Promise-based instance in ./index.ts, so there are two small
// pools: @effect/sql-pg speaks the Postgres protocol itself and has no pg.Pool to share.

// paramsInErrors: failed queries carry their values inside the process, so error reports can
// show each value's kind; redact.ts strips the values before anything is logged or sent.
const makeDatabase = PgDrizzle.makeWithDefaults({ paramsInErrors: true });

export class Database extends Context.Service<Database, Effect.Success<typeof makeDatabase>>()(
  'roundtable/Database',
) {
  static readonly layer = (url: Redacted.Redacted<string>) =>
    Layer.effect(Database, makeDatabase).pipe(Layer.provide(PgClient.layer({ url })));
}
