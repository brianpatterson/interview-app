import { Redacted } from 'effect';
import { createDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';

const url = process.env.DATABASE_URL;

if (!url) throw new Error('DATABASE_URL is not set');

const { db, pool } = createDb(Redacted.make(url));

await runMigrations(db);

await pool.end();

console.log('Migrations applied');
