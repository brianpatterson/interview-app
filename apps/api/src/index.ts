import { buildApp } from './app.js';
import { createDb } from './db/index.js';
import { loadEnv } from './env.js';

const env = loadEnv();
const { db } = createDb(env.DATABASE_URL);
const app = buildApp(db, env);

await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
