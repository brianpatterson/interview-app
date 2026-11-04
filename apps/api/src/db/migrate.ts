import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import type { Db } from './index.js';

// In the bundled production image the SQL files sit next to dist/, so the path is configurable.
export const migrationsFolder =
  process.env.MIGRATIONS_FOLDER ?? fileURLToPath(new URL('../../drizzle', import.meta.url));

export function runMigrations(db: Db) {
  return migrate(db, { migrationsFolder });
}
