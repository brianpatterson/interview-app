import Fastify from 'fastify';
import { sql } from 'drizzle-orm';
import type { HealthResponse } from '@interview-app/shared';
import { createAuth, enabledProviders } from './auth.js';
import type { Db } from './db/index.js';
import { logMailer, type SendEmail } from './email.js';
import type { Env } from './env.js';
import { applicationRoutes } from './routes/applications.js';
import { authRoutes } from './routes/auth.js';

export function buildApp(db: Db, env: Env, opts: { logger?: boolean; sendEmail?: SendEmail } = {}) {
  const app = Fastify({ logger: opts.logger ?? true });
  const auth = createAuth(db, env, opts.sendEmail ?? logMailer(app.log));

  app.get('/api/health', async (): Promise<HealthResponse> => {
    let dbStatus: HealthResponse['db'] = 'up';
    try {
      await db.execute(sql`select 1`);
    } catch {
      dbStatus = 'down';
    }
    return { ok: true, db: dbStatus, time: new Date().toISOString() };
  });

  authRoutes(app, auth, enabledProviders(env));
  // Registered as a plugin so its auth hook only applies to these routes.
  app.register(async (scope) => applicationRoutes(scope, db, auth));
  return app;
}
