import Fastify from 'fastify';
import type { HealthResponse } from '@app/shared';
import { pool } from './db.js';

const app = Fastify({ logger: true });

app.get('/api/health', async (): Promise<HealthResponse> => {
  let db: HealthResponse['db'] = 'up';
  try {
    await pool.query('select 1');
  } catch {
    db = 'down';
  }
  return { ok: true, db, time: new Date().toISOString() };
});

const port = Number(process.env.API_PORT ?? 3001);
await app.listen({ port, host: '0.0.0.0' });
