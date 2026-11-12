import { and, desc, eq, sql } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { HttpEffect, HttpRouter, HttpServer, HttpServerRequest } from 'effect/http';
import { HttpApiBuilder } from 'effect/http-api';
import { createAuth, type Auth } from '../../../apps/api/src/auth.js';
import { applications } from '../../../apps/api/src/db/schema.js';
import type { SendEmail } from '../../../apps/api/src/email.js';
import type { Env } from '../../../apps/api/src/env.js';
import { Api, ApplicationNotFound, Authorization, CurrentUser, Unauthorized } from './Api.js';
import { Database } from './Database.js';

/** Better Auth, unchanged, as a service. It keeps its own Promise API; we wrap calls at the edge. */
export class BetterAuth extends Context.Service<BetterAuth, Auth>()('roundtable/BetterAuth') {
  static readonly layer = (env: Env, sendEmail: SendEmail) =>
    Layer.effect(
      BetterAuth,
      Effect.gen(function* () {
        const { drizzle } = yield* Database;

        return BetterAuth.of(createAuth(drizzle, env, sendEmail));
      }),
    );
}

/** The session check, as middleware. Handlers behind it can't run without a CurrentUser. */
const AuthorizationLive = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const auth = yield* BetterAuth;

    return Authorization.of((httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const session = yield* Effect.promise(() =>
          auth.api.getSession({ headers: new Headers(request.headers) }),
        );

        if (!session) return yield* new Unauthorized();

        return yield* Effect.provideService(httpEffect, CurrentUser, { id: session.user.id });
      }),
    );
  }),
);

const SystemLive = HttpApiBuilder.group(
  Api,
  'system',
  Effect.fn(function* (handlers) {
    const db = yield* Database;

    return handlers.handleAll({
      health: () =>
        db.use((d) => d.execute(sql`select 1`)).pipe(
          Effect.as('up' as const),
          Effect.orElseSucceed(() => 'down' as const),
          Effect.map((status) => ({ ok: true, db: status, time: new Date().toISOString() })),
        ),
    });
  }),
);

const ApplicationsLive = HttpApiBuilder.group(
  Api,
  'applications',
  Effect.fn(function* (handlers) {
    const db = yield* Database;
    const ownedBy = (userId: string, id: string) =>
      and(eq(applications.id, id), eq(applications.userId, userId));

    return handlers.handleAll({
      list: () =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;

          return yield* db.use((d) =>
            d
              .select()
              .from(applications)
              .where(eq(applications.userId, user.id))
              .orderBy(desc(applications.updatedAt)),
          );
        }).pipe(Effect.orDie),

      create: ({ payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          const [row] = yield* db.use((d) =>
            d
              .insert(applications)
              .values({ ...payload, userId: user.id })
              .returning(),
          );

          if (!row) return yield* Effect.die('insert returned no row');

          return row;
        }).pipe(Effect.catchTag('DbError', Effect.die)),

      update: ({ params, payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          const [row] = yield* db.use((d) =>
            d.update(applications).set(payload).where(ownedBy(user.id, params.id)).returning(),
          );

          // Another user's row and a missing row look the same: 404, never 403.
          if (!row) return yield* new ApplicationNotFound();

          return row;
        }).pipe(Effect.catchTag('DbError', Effect.die)),
    });
  }),
);

/**
 * Better Auth's own endpoints, mounted as a plain route: its handler is already Request → Response.
 * BetterAuth is resolved once while the route is built: a route handler's own requirements are
 * per-request, and Layer.provide on the router doesn't satisfy them.
 */
const AuthRoute = Layer.unwrap(
  Effect.gen(function* () {
    const auth = yield* BetterAuth;

    return HttpRouter.add('*', '/api/auth/*', HttpEffect.fromWebHandler(auth.handler));
  }),
);

/** Every route, with its services. Serve it with HttpRouter.serve or turn it into a web handler. */
export const makeRoutes = (env: Env, sendEmail: SendEmail) => {
  const Services = BetterAuth.layer(env, sendEmail).pipe(
    Layer.provideMerge(Database.layer(env.DATABASE_URL)),
  );

  const ApiRoutes = HttpApiBuilder.layer(Api).pipe(
    Layer.provide([SystemLive, ApplicationsLive]),
    Layer.provide(AuthorizationLive),
  );

  return Layer.mergeAll(ApiRoutes, AuthRoute).pipe(Layer.provide(Services));
};

/** A fetch-style handler for tests (and serverless): no port, same pipeline as the real server. */
export const makeWebHandler = (env: Env, sendEmail: SendEmail) =>
  HttpRouter.toWebHandler(makeRoutes(env, sendEmail).pipe(Layer.provide(HttpServer.layerServices)));
