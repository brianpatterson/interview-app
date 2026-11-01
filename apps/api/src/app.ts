import Fastify from 'fastify';
import { sql } from 'drizzle-orm';
import type { HealthResponse } from '@interview-app/shared';
import type { Db } from './db/index.js';
import { applicationRoutes } from './routes/applications.js';

export function buildApp(db: Db, opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? true });

  app.get('/api/health', async (): Promise<HealthResponse> => {
    let dbStatus: HealthResponse['db'] = 'up';
    try {
      await db.execute(sql`select 1`);
    } catch {
      dbStatus = 'down';
    }
    return { ok: true, db: dbStatus, time: new Date().toISOString() };
  });

  applicationRoutes(app, db);
  return app;
}
