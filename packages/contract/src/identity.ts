// The identity module's contract: who the caller is, and how they can sign in. Better Auth's own
// routes under /api/auth/* are mounted by the API outside this contract.
import { Context, ErrorReporter, Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware } from 'effect/http-api';

export const AuthProvider = Schema.Literals(['github', 'google']);

export type AuthProvider = typeof AuthProvider.Type;

/** Which social sign-in providers this deployment has configured. */
export const AuthConfig = Schema.Struct({ providers: Schema.Array(AuthProvider) });

export type AuthConfig = typeof AuthConfig.Type;

// Expected outcomes set ErrorReporter.ignore, or Sentry reports every 401 as an error
// (ADR-0022). contract.test.ts fails if a 4xx error forgets it.
export class Unauthorized extends Schema.TaggedError<
  Unauthorized,
  { readonly brand: unique symbol }
>()('Unauthorized', {}, { httpApiStatus: 401 }) {
  readonly [ErrorReporter.ignore] = true;
}

/** The signed-in user, provided by the Authorization middleware to every handler behind it. */
export class CurrentUser extends Context.Service<CurrentUser, { readonly id: string }>()(
  'roundtable/CurrentUser',
) {}

/**
 * Resolves the caller to a CurrentUser, or fails with Unauthorized. Other modules' groups put
 * this middleware in front of their endpoints; the identity module implements it.
 */
export class Authorization extends HttpApiMiddleware.Service<
  Authorization,
  { provides: CurrentUser; requires: never }
>()('roundtable/Authorization', { error: Unauthorized }) {}

/** Public: the sign-in page asks which providers to offer before anyone is signed in. */
export class IdentityApi extends HttpApiGroup.make('identity').add(
  HttpApiEndpoint.get('authConfig', '/api/auth-config', { success: AuthConfig }),
) {}
