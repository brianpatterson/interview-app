// The API contract as an Effect `HttpApi` definition (ADR-0022, step 3). It mirrors the Zod schemas
// in `index.ts`, which the current Fastify server and the web app still use; a parity test in
// `apps/api/test/contract.test.ts` checks the two accept and reject the same input. The server
// serves this from step 4 and the web app calls it through the generated client from step 5, when
// the Zod schemas go. No server code here: the web app imports this file.
import { Context, ErrorReporter, Schema } from 'effect';
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from 'effect/http-api';

export const ApplicationStatus = Schema.Literals([
  'applied',
  'screening',
  'interviewing',
  'offer',
  'accepted',
  'rejected',
  'withdrawn',
]);

export type ApplicationStatus = typeof ApplicationStatus.Type;

/** Company and job title: trimmed, then 1–200 characters. */
const Text = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(200));

const isWebUrl = (value: string) =>
  URL.canParse(value) && ['http:', 'https:'].includes(new URL(value).protocol);

/**
 * http(s) only: the web app renders it as a link, so `javascript:` or `data:` URLs would be a
 * stored-XSS path if React or the CSP ever stopped blocking them.
 */
const JobUrl = Schema.String.check(
  Schema.isMaxLength(2000),
  Schema.makeFilter((value: string) => (isWebUrl(value) ? undefined : 'must be an http(s) URL')),
);

export const CreateApplication = Schema.Struct({
  company: Text,
  jobTitle: Text,
  jobUrl: Schema.optional(Schema.NullOr(JobUrl)),
  status: Schema.optional(ApplicationStatus),
});

export type CreateApplication = typeof CreateApplication.Type;

export const UpdateApplication = Schema.Struct({
  company: Schema.optional(Text),
  jobTitle: Schema.optional(Text),
  jobUrl: Schema.optional(Schema.NullOr(JobUrl)),
  status: Schema.optional(ApplicationStatus),
}).check(
  Schema.makeFilter((value) =>
    Object.keys(value).length > 0 ? undefined : 'At least one field is required',
  ),
);

export type UpdateApplication = typeof UpdateApplication.Type;

/** An application as the API returns it: `Date`s in code, ISO 8601 strings on the wire. */
export const Application = Schema.Struct({
  id: Schema.String,
  company: Schema.String,
  jobTitle: Schema.String,
  jobUrl: Schema.NullOr(Schema.String),
  status: ApplicationStatus,
  createdAt: Schema.DateFromString,
  updatedAt: Schema.DateFromString,
});

export type Application = typeof Application.Type;

export const AuthProvider = Schema.Literals(['github', 'google']);

export type AuthProvider = typeof AuthProvider.Type;

/** Which social sign-in providers this deployment has configured. */
export const AuthConfig = Schema.Struct({ providers: Schema.Array(AuthProvider) });

export type AuthConfig = typeof AuthConfig.Type;

export const Health = Schema.Struct({
  ok: Schema.Boolean,
  db: Schema.Literals(['up', 'down']),
  time: Schema.String,
});

export type Health = typeof Health.Type;

// Expected outcomes set ErrorReporter.ignore, or Sentry reports every 401 and 404 as an error
// (ADR-0022). contract.test.ts fails if a 4xx error here forgets it.

/** A missing application, or another user's: always 404, never 403, so existence never leaks. */
export class ApplicationNotFound extends Schema.TaggedError<
  ApplicationNotFound,
  { readonly brand: unique symbol }
>()('ApplicationNotFound', {}, { httpApiStatus: 404 }) {
  readonly [ErrorReporter.ignore] = true;
}

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

/** Resolves the Better Auth session cookie to a CurrentUser, or fails with Unauthorized. */
export class Authorization extends HttpApiMiddleware.Service<
  Authorization,
  { provides: CurrentUser; requires: never }
>()('roundtable/Authorization', { error: Unauthorized }) {}

/** Public endpoints. (Better Auth's own routes under /api/auth/* are mounted separately.) */
export class SystemApi extends HttpApiGroup.make('system').add(
  HttpApiEndpoint.get('health', '/api/health', { success: Health }),
  HttpApiEndpoint.get('authConfig', '/api/auth-config', { success: AuthConfig }),
) {}

/** A malformed id fails the params schema: 400 (ADR-0022), before any handler runs. */
const IdParams = { id: Schema.String.check(Schema.isUUID()) };

export class ApplicationsApi extends HttpApiGroup.make('applications')
  .add(
    HttpApiEndpoint.get('list', '/', { success: Schema.Array(Application) }),
    HttpApiEndpoint.get('get', '/:id', {
      params: IdParams,
      success: Application,
      error: ApplicationNotFound,
    }),
    HttpApiEndpoint.post('create', '/', {
      payload: CreateApplication,
      success: Application.pipe(HttpApiSchema.status(201)),
    }),
    HttpApiEndpoint.patch('update', '/:id', {
      params: IdParams,
      payload: UpdateApplication,
      success: Application,
      error: ApplicationNotFound,
    }),
    HttpApiEndpoint.delete('delete', '/:id', {
      params: IdParams,
      success: HttpApiSchema.NoContent,
      error: ApplicationNotFound,
    }),
  )
  .middleware(Authorization)
  .prefix('/api/applications') {}

/**
 * ProblemDetails: a request that fails decoding gets a 400 RFC 9457 problem saying which value
 * was invalid and why (and an unencodable response a 500), instead of an empty 400.
 */
export class RoundtableApi extends HttpApi.make('roundtable')
  .add(SystemApi)
  .add(ApplicationsApi)
  .middleware(HttpApiMiddleware.ProblemDetails) {}
