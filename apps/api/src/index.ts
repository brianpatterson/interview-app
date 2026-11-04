import { buildApp } from './app.js';
import { createDb } from './db/index.js';
import { loadEnv } from './env.js';

const env = loadEnv();
const { db, pool } = createDb(env.DATABASE_URL);
const app = buildApp(db, env);

await app.listen({ port: env.API_PORT, host: '0.0.0.0' });

// Docker sends SIGTERM on stop/deploy. Finish in-flight requests, then release DB connections,
// instead of being killed mid-request when the 10-second grace period runs out.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'Shutting down');
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
