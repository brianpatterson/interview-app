import { and, desc, eq, sql } from 'drizzle-orm';
import { NodeHttpServer } from '@effect/platform-node';
import { Context, Effect, Layer } from 'effect';
import { HttpEffect, HttpRouter, HttpServerRequest } from 'effect/http';
import { HttpApiBuilder, HttpApiMiddleware } from 'effect/http-api';
import {
  ApplicationNotFound,
  Authorization,
  CurrentUser,
  RoundtableApi,
  Unauthorized,
} from '@roundtable/shared/api';
import { createAuth, enabledProviders, type Auth } from './auth.js';
import { Database } from './db/effect.js';
import type { Db } from './db/index.js';
import { applications } from './db/schema.js';
import { createServer } from 'node:http';
import { mailerFromEnv, type SendEmail } from './email.js';
import { limitedMailer } from './email-limits.js';
import type { Env } from './env.js';
import { Sentry, SentryErrorReporter } from './error-tracking.js';
import { effectLoggerLayer, type Log } from './logging.js';

/** Better Auth as a service: its own Promise API, called at the edge (ADR-0022). */
export class BetterAuth extends Context.Service<BetterAuth, Auth>()('roundtable/BetterAuth') {}

/**
 * The session check for every route behind it (the applications group). No session is a typed
 * Unauthorized (401). A failing session lookup (database down) is a defect: a 500, reported.
 */
const AuthorizationLive = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const auth = yield* BetterAuth;

    return Authorization.of((httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;

        const session = yield* Effect.tryPromise(() =>
          auth.api.getSession({ headers: new Headers(request.headers) }),
        ).pipe(Effect.orDie);

        if (!session) return yield* new Unauthorized();

        return yield* Effect.provideService(httpEffect, CurrentUser, { id: session.user.id });
      }),
    );
  }),
);

const SystemLive = (env: Env) =>
  HttpApiBuilder.group(
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
        authConfig: () => Effect.succeed({ providers: enabledProviders(env) }),
      });
    }),
  );

/**
 * Every query filters on the signed-in user (CurrentUser, from the Authorization middleware).
 * Another user's row and a missing row are the same 404, so the API never confirms an id exists.
 * Database failures are defects: a 500, reported to Sentry with the redaction in redact.ts.
 */
const ApplicationsLive = HttpApiBuilder.group(
  RoundtableApi,
  'applications',
  Effect.fn(function* (handlers) {
    const db = yield* Database;

    const ownedBy = (userId: string, id: string) =>
      and(eq(applications.id, id), eq(applications.userId, userId));

    return handlers.handleAll({
      list: () =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;

          return yield* db
            .select()
            .from(applications)
            .where(eq(applications.userId, user.id))
            .orderBy(desc(applications.updatedAt));
        }).pipe(Effect.orDie),

      get: ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;

          const [row] = yield* db
            .select()
            .from(applications)
            .where(ownedBy(user.id, params.id))
            .pipe(Effect.orDie);

          if (!row) return yield* new ApplicationNotFound();

          return row;
        }),

      create: ({ payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;

          const [row] = yield* db
            .insert(applications)
            .values({ ...payload, userId: user.id })
            .returning()
            .pipe(Effect.orDie);

          if (!row) return yield* Effect.die(new Error('insert returned no row'));

          return row;
        }),

      update: ({ params, payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;

          const [row] = yield* db
            .update(applications)
            .set(payload)
            .where(ownedBy(user.id, params.id))
            .returning()
            .pipe(Effect.orDie);

          if (!row) return yield* new ApplicationNotFound();

          return row;
        }),

      delete: ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;

          const [row] = yield* db
            .delete(applications)
            .where(ownedBy(user.id, params.id))
            .returning({ id: applications.id })
            .pipe(Effect.orDie);

          if (!row) return yield* new ApplicationNotFound();
        }),
    });
  }),
);

/**
 * Better Auth's own endpoints under /api/auth/*, as a plain route: its handler is already
 * Request → Response. BetterAuth is resolved while the route is built, because a route handler's
 * own requirements are per request and Layer.provide on the router wouldn't satisfy them.
 */
const BetterAuthRoute = Layer.unwrap(
  Effect.gen(function* () {
    const auth = yield* BetterAuth;

    return HttpRouter.add('*', '/api/auth/*', HttpEffect.fromWebHandler(auth.handler));
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
  /** Promise-based Drizzle, for Better Auth and the email limits. */
  db: Db;
  log: Log;
  /** Replaces the mailer from the environment (tests capture emails with it). */
  sendEmail?: SendEmail;
}

/**
 * The whole API as one Layer of routes: the HttpApi contract from @roundtable/shared/api, Better
 * Auth's routes, and the services they need. Serve it (index.ts) or turn it into a web handler
 * (tests); either way the same code answers. Provide observabilityLayer around it.
 */
export function appLayer({ env, db, log, sendEmail }: AppOptions) {
  const mailer = limitedMailer(
    db,
    sendEmail ?? mailerFromEnv(env, log),
    { perAddress: env.EMAIL_LIMIT_PER_ADDRESS, perDay: env.EMAIL_LIMIT_PER_DAY },
    log,
  );

  const auth = createAuth(db, env, mailer, log, (error) => {
    log.error({ err: error }, 'Unexpected error in auth');
    Sentry.captureException(error);
  });

  const api = HttpApiBuilder.layer(RoundtableApi).pipe(
    Layer.provide([SystemLive(env), ApplicationsLive]),
    Layer.provide(AuthorizationLive),
    // Name the invalid values in 400s: clients, and agents reading a failure, see what was wrong.
    Layer.provide(HttpApiMiddleware.layerProblemDetails({ includeDetails: true })),
  );

  return Layer.mergeAll(api, BetterAuthRoute, ReportErrors).pipe(
    Layer.provide(Layer.succeed(BetterAuth, auth)),
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
 * logs then go to the console, unredacted). index.ts serves this; server.test.ts checks it.
 */
export function serverLayer(options: AppOptions & { port: number; host?: string }) {
  return HttpRouter.serve(appLayer(options)).pipe(
    Layer.provide(
      NodeHttpServer.layer(createServer, { port: options.port, host: options.host ?? '0.0.0.0' }),
    ),
    Layer.provide(observabilityLayer(options.log)),
  );
}
