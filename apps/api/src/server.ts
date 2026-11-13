import { sql } from 'drizzle-orm';
import { NodeHttpServer } from '@effect/platform-node';
import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/http';
import { HttpApiBuilder, HttpApiMiddleware } from 'effect/http-api';
import { RoundtableApi } from '@roundtable/contract';
import { createServer } from 'node:http';
import { ApplicationsLive } from './modules/applications/index.js';
import { EmailTransport, Mailer, transportFromEnv, type SendEmail } from './modules/email/index.js';
import {
  AuthorizationLive,
  BetterAuthRoute,
  betterAuthLayer,
  IdentityLive,
} from './modules/identity/index.js';
import type { Env } from './platform/config/env.js';
import { Database } from './platform/database/effect.js';
import type { Db } from './platform/database/promise.js';
import { SentryErrorReporter } from './platform/observability/error-tracking.js';
import { effectLoggerLayer, type Log } from './platform/observability/logging.js';

// Assembles the modules (ADR-0023) into one server. This is the only file that knows every
// module; each module's handlers, middleware and tables live in its own folder under modules/.

/** The API's own endpoints, outside any module: the health check deploys and monitors use. */
const SystemLive = HttpApiBuilder.group(
  RoundtableApi,
  'system',
  Effect.fn(function* (handlers) {
    const db = yield* Database;

    return handlers.handleAll({
      health: () =>
        db.execute(sql`select 1`).pipe(
          Effect.as('up' as const),
          Effect.orElseSucceed(() => 'down' as const),
          Effect.map((status) => ({ ok: true, db: status, time: new Date().toISOString() })),
        ),
    });
  }),
);

/**
 * Report unexpected failures from every route, not only HttpApi endpoints: HttpApiBuilder wraps
 * its handlers in withErrorReporting, but plain routes (Better Auth's) get no reporting otherwise.
 * ErrorReporter dedupes by cause, so an endpoint failure is still reported once.
 */
const ReportErrors = HttpRouter.middleware((httpEffect) => Effect.withErrorReporting(httpEffect), {
  global: true,
});

export interface AppOptions {
  env: Env;
  /** Promise-based Drizzle, for Better Auth. */
  db: Db;
  log: Log;
  /** Replaces the email transport from the environment (tests capture emails with it). */
  sendEmail?: SendEmail;
}

/**
 * The whole API as one Layer of routes: the HttpApi contract from @roundtable/contract, Better
 * Auth's routes, and the services they need. Serve it (main.ts) or turn it into a web handler
 * (tests); either way the same code answers. Provide observabilityLayer around it.
 */
export function appLayer({ env, db, log, sendEmail }: AppOptions) {
  const mailer = Mailer.layer({
    perAddress: env.EMAIL_LIMIT_PER_ADDRESS,
    perDay: env.EMAIL_LIMIT_PER_DAY,
  }).pipe(
    Layer.provide(sendEmail ? EmailTransport.fromPromise(sendEmail) : transportFromEnv(env, log)),
  );

  const api = HttpApiBuilder.layer(RoundtableApi).pipe(
    Layer.provide([SystemLive, IdentityLive(env), ApplicationsLive]),
    Layer.provide(AuthorizationLive),
    // Name the invalid values in 400s: clients, and agents reading a failure, see what was wrong.
    Layer.provide(HttpApiMiddleware.layerProblemDetails({ includeDetails: true })),
  );

  return Layer.mergeAll(api, BetterAuthRoute, ReportErrors).pipe(
    Layer.provide(betterAuthLayer(db, env, log)),
    Layer.provide(mailer),
    Layer.provide(Database.layer(env.DATABASE_URL)),
  );
}

/**
 * Logging and error reporting: Effect's logs go to `log` (pino, redacted), and unexpected
 * failures to Sentry when it's set up. Use Layer.provideMerge, not provide: request fibers run
 * in the server's context, and a plain provide leaves both out of it (Effect logs would go to
 * the console unredacted, and plain routes' failures unreported). Kept apart from appLayer so
 * it also covers routes added around it (the tests' crash route).
 */
export function observabilityLayer(log: Log) {
  return Layer.mergeAll(effectLoggerLayer(log), SentryErrorReporter);
}

/**
 * The API on a real Node HTTP server, with logging and error reporting wrapped around all of it.
 * They must wrap the Node server too: it forks its request-handling fiber while it's being
 * built, and anything provided only to the routes misses request handling (Effect's request
 * logs then go to the console, unredacted). main.ts serves this; server.test.ts checks it.
 */
export function serverLayer(options: AppOptions & { port: number; host?: string }) {
  return HttpRouter.serve(appLayer(options)).pipe(
    Layer.provide(
      NodeHttpServer.layer(createServer, { port: options.port, host: options.host ?? '0.0.0.0' }),
    ),
    Layer.provide(observabilityLayer(options.log)),
  );
}
