// The API contract (ADR-0022): every endpoint, its request and response schemas, and its errors,
// as an Effect `HttpApi` definition, one file per module (ADR-0023). The server implements it
// (apps/api) and the web app calls it through the typed client in `client/`. No server code here:
// the web app imports this package, so everything in it ends up in the browser bundle.
import { HttpApi, HttpApiMiddleware } from 'effect/http-api';
import { ApplicationsApi } from './applications.js';
import { IdentityApi } from './identity.js';
import { SystemApi } from './system.js';

export * from './applications.js';

export * from './identity.js';

export * from './system.js';

/**
 * ProblemDetails: a request that fails decoding gets a 400 RFC 9457 problem saying which value
 * was invalid and why (and an unencodable response a 500), instead of an empty 400.
 */
export class RoundtableApi extends HttpApi.make('roundtable')
  .add(SystemApi)
  .add(IdentityApi)
  .add(ApplicationsApi)
  .middleware(HttpApiMiddleware.ProblemDetails) {}
