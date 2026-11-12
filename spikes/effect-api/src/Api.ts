// The API contract: what packages/shared would become. No server code here, so the web app can
// import it to get a typed client without pulling in Drizzle or Better Auth.
import { Context, ErrorReporter, Schema } from 'effect';
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware } from 'effect/http-api';

export const ApplicationStatus = Schema.Literals([
  'applied',
  'screening',
  'interviewing',
  'offer',
  'accepted',
  'rejected',
  'withdrawn',
]);

const Text = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(200));

/** An application as the API returns it. Dates are `Date`s in code and ISO strings on the wire. */
export const Application = Schema.Struct({
  id: Schema.String,
  company: Schema.String,
  jobTitle: Schema.String,
  jobUrl: Schema.NullOr(Schema.String),
  status: ApplicationStatus,
  createdAt: Schema.DateFromString,
  updatedAt: Schema.DateFromString,
});

export const CreateApplication = Schema.Struct({
  company: Text,
  jobTitle: Text,
  jobUrl: Schema.optional(Schema.NullOr(Schema.String.check(Schema.isMaxLength(2000)))),
  status: Schema.optional(ApplicationStatus),
});

export const UpdateApplication = Schema.Struct({
  company: Schema.optional(Text),
  jobTitle: Schema.optional(Text),
  jobUrl: Schema.optional(Schema.NullOr(Schema.String.check(Schema.isMaxLength(2000)))),
  status: Schema.optional(ApplicationStatus),
});

export class ApplicationNotFound extends Schema.TaggedError<ApplicationNotFound>()(
  'ApplicationNotFound',
  {},
  { httpApiStatus: 404 },
) {
  // Expected outcome, not a bug: keep it out of error tracking (Sentry reports everything else).
  readonly [ErrorReporter.ignore] = true;
}

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  'Unauthorized',
  {},
  { httpApiStatus: 401 },
) {
  // Expected outcome, not a bug: keep it out of error tracking (Sentry reports everything else).
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

export class SystemApi extends HttpApiGroup.make('system').add(
  HttpApiEndpoint.get('health', '/api/health', {
    success: Schema.Struct({
      ok: Schema.Boolean,
      db: Schema.Literals(['up', 'down']),
      time: Schema.String,
    }),
  }),
) {}

export class ApplicationsApi extends HttpApiGroup.make('applications')
  .add(
    HttpApiEndpoint.get('list', '/', { success: Schema.Array(Application) }),
    HttpApiEndpoint.post('create', '/', { payload: CreateApplication, success: Application }),
    HttpApiEndpoint.patch('update', '/:id', {
      params: { id: Schema.String.check(Schema.isUUID()) },
      payload: UpdateApplication,
      success: Application,
      error: ApplicationNotFound,
    }),
  )
  .middleware(Authorization)
  .prefix('/api/applications') {}

export class Api extends HttpApi.make('roundtable').add(SystemApi).add(ApplicationsApi) {}
