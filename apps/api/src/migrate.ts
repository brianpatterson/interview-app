import { createDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';

const { db, pool } = createDb(process.env.DATABASE_URL!);
await runMigrations(db);
await pool.end();
console.log('Migrations applied');
