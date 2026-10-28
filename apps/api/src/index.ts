import { buildApp } from './app.js';
import { createDb } from './db/index.js';

const { db } = createDb(process.env.DATABASE_URL!);
const app = buildApp(db);

const port = Number(process.env.API_PORT ?? 3001);
await app.listen({ port, host: '0.0.0.0' });
