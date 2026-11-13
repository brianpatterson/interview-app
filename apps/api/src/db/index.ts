import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Redacted } from 'effect';
import pg from 'pg';

export type Db = NodePgDatabase;

/** The URL holds the database password, so it arrives `Redacted` and is unwrapped only here. */
export function createDb(url: Redacted.Redacted<string>) {
  const pool = new pg.Pool({ connectionString: Redacted.value(url) });

  // paramsInErrors: failed queries carry their values inside the process, so error reports can
  // show each value's kind (uuid, string(32), null). redact.ts strips the values themselves
  // before anything is logged or sent (ADR-0022), and the leak tests check that.
  return { db: drizzle({ client: pool, paramsInErrors: true }), pool };
}
