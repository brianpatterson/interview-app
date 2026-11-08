import Fastify from 'fastify';
import { sql } from 'drizzle-orm';
import type { HealthResponse } from '@interview-app/shared';
import { createAuth, enabledProviders } from './auth.js';
import type { Db } from './db/index.js';
import { mailerFromEnv, type SendEmail } from './email.js';
import { limitedMailer } from './email-limits.js';
import type { Env } from './env.js';
import { applicationRoutes } from './routes/applications.js';
import { authRoutes } from './routes/auth.js';

export function buildApp(db: Db, env: Env, opts: { logger?: boolean; sendEmail?: SendEmail } = {}) {
  // Behind Caddy in production (and Vite in dev): use X-Forwarded-* for the client IP and protocol.
  const app = Fastify({ logger: opts.logger ?? true, trustProxy: true });
  const sendEmail = limitedMailer(
    db,
    opts.sendEmail ?? mailerFromEnv(env, app.log),
    { perAddress: env.EMAIL_LIMIT_PER_ADDRESS, perDay: env.EMAIL_LIMIT_PER_DAY },
    app.log,
  );
  const auth = createAuth(db, env, sendEmail);

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
