import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

export type Db = NodePgDatabase;

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString });

  // paramsInErrors: failed queries carry their values inside the process, so error reports can
  // show each value's kind (uuid, string(32), null). redact.ts strips the values themselves
  // before anything is logged or sent (ADR-0022), and the leak tests check that.
  return { db: drizzle({ client: pool, paramsInErrors: true }), pool };
}
