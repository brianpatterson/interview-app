// The API contract (ADR-0022): every endpoint, its request and response schemas, and its errors,
// as an Effect `HttpApi` definition. The server implements it (apps/api/src/app.ts) and the web app
// calls it through the typed client in `client.ts`. No server code here: the web app imports this
// file, so everything in it ends up in the browser bundle.
import { Context, ErrorReporter, Schema, SchemaGetter, SchemaTransformation } from 'effect';
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from 'effect/http-api';

/** In display order. Also the Postgres enum's values (apps/api/src/db/schema.ts). */
export const APPLICATION_STATUSES = [
  'applied',
  'screening',
  'interviewing',
  'offer',
  'accepted',
  'rejected',
  'withdrawn',
] as const;

export const ApplicationStatus = Schema.Literals(APPLICATION_STATUSES);

export type ApplicationStatus = typeof ApplicationStatus.Type;

export const isApplicationStatus = Schema.is(ApplicationStatus);

const MAX_TEXT = 200;

/**
 * Company and job title: 1–200 characters once trimmed. Trimmed in both directions: the server
 * trims what it receives, and the typed client trims what it sends. (`Schema.Trim` only trims on
 * decode, so the client would refuse to encode " Acme" from a form instead of sending "Acme".)
 */
const Text = Schema.String.pipe(
  Schema.decodeTo(
    Schema.String.check(
      Schema.makeFilter((value: string) => {
        const length = value.trim().length;

        if (length === 0) return 'must not be blank';

        return length > MAX_TEXT ? `must be at most ${MAX_TEXT} characters` : undefined;
      }),
    ),
    new SchemaTransformation.Transformation(SchemaGetter.trim(), SchemaGetter.trim()),
  ),
);

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
