import { Context, Effect, Layer } from 'effect';
import { HttpEffect, HttpRouter, HttpServerRequest } from 'effect/http';
import { HttpApiBuilder } from 'effect/http-api';
import { Authorization, CurrentUser, RoundtableApi, Unauthorized } from '@roundtable/contract';
import type { Env } from '../../platform/config/env.js';
import type { Db } from '../../platform/database/promise.js';
import { Sentry } from '../../platform/observability/error-tracking.js';
import type { Log } from '../../platform/observability/logging.js';
import { Mailer } from '../email/index.js';
import { createAuth, enabledProviders, type Auth } from './better-auth.js';

/** Better Auth as a service: its own Promise API, called at the edge (ADR-0022). */
export class BetterAuth extends Context.Service<BetterAuth, Auth>()('roundtable/BetterAuth') {}

/**
 * Better Auth, sending its emails through the Mailer. It calls back with Promises, so its emails
 * run through the Mailer on the context this layer is built in: the same logger and error
 * reporter as the routes.
 */
export const betterAuthLayer = (db: Db, env: Env, log: Log) =>
  Layer.effect(
    BetterAuth,
    Effect.gen(function* () {
      const { send } = yield* Mailer;
      const run = Effect.runPromiseWith(yield* Effect.context<never>());

      return createAuth(
        db,
        env,
        (email) => run(send(email)),
        log,
        (error) => {
          log.error({ err: error }, 'Unexpected error in auth');
          Sentry.captureException(error);
        },
      );
    }),
  );

/**
 * The session check for every group behind it (applications). No session is a typed
 * Unauthorized (401). A failing session lookup (database down) is a defect: a 500, reported.
 */
export const AuthorizationLive = Layer.effect(
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

/** The identity group of the contract: which sign-in providers this deployment offers. */
export const IdentityLive = (env: Env) =>
  HttpApiBuilder.group(RoundtableApi, 'identity', (handlers) =>
    handlers.handleAll({
      authConfig: () => Effect.succeed({ providers: enabledProviders(env) }),
    }),
  );

/**
 * Better Auth's own endpoints under /api/auth/*, as a plain route: its handler is already
 * Request → Response. BetterAuth is resolved while the route is built, because a route handler's
 * own requirements are per request and Layer.provide on the router wouldn't satisfy them.
 */
export const BetterAuthRoute = Layer.unwrap(
  Effect.gen(function* () {
    const auth = yield* BetterAuth;

    return HttpRouter.add('*', '/api/auth/*', HttpEffect.fromWebHandler(auth.handler));
  }),
);
