// The web app's API client (ADR-0022 step 5): generated from the contract in `index.ts`, so every
// call, payload and response is typed by it, and request bodies are checked before they're sent.
// TanStack Query wants Promises, so this is where Effect ends on the web side: each call runs to a
// Promise that resolves with the decoded response or rejects with an ApiError.
//
// It lives here rather than in apps/web so the API tests can run it against the real server
// (apps/api/test/client.test.ts) without a browser.
import { Effect, Schema } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { HttpApiClient } from 'effect/http-api';
import {
  ApplicationNotFound,
  RoundtableApi,
  Unauthorized,
  type CreateApplication,
  type UpdateApplication,
} from './index.js';

/** A failed API call, with a message fit to show the user. `cause` is the original error. */
export class ApiError extends Error {
  override name = 'ApiError';
}

const isUnauthorized = Schema.is(Unauthorized);
const isNotFound = Schema.is(ApplicationNotFound);

function toApiError(cause: unknown): ApiError {
  // The contract's own errors carry no message, so the wording lives here.
  if (isUnauthorized(cause))
    return new ApiError('You have been signed out. Sign in again.', { cause });

  if (isNotFound(cause)) return new ApiError('That application no longer exists.', { cause });

  // A request body the contract rejects, caught before it's sent: says which field and why.
  if (Schema.isSchemaError(cause)) return new ApiError(cause.message, { cause });

  return new ApiError('Something went wrong. Please try again.', { cause });
}

export interface ApiClientOptions {
  /** Where the API is. The web app passes its own origin; paths already start with /api. */
  readonly baseUrl: string;
  /** Replaces the global fetch, e.g. to call a server in-process from tests. */
  readonly fetch?: typeof globalThis.fetch;
}

type Client = HttpApiClient.ForApi<typeof RoundtableApi>;

export function makeApiClient(options: ApiClientOptions) {
  const run = <A, E>(call: (client: Client) => Effect.Effect<A, E>): Promise<A> =>
    Effect.runPromise(
      HttpApiClient.make(RoundtableApi, { baseUrl: options.baseUrl }).pipe(
        Effect.flatMap(call),
        Effect.mapError(toApiError),
        Effect.catchDefect((defect) => Effect.fail(toApiError(defect))),
        Effect.provide(FetchHttpClient.layer),
        options.fetch ? Effect.provideService(FetchHttpClient.Fetch, options.fetch) : (e) => e,
      ),
    );

  return {
    authConfig: () => run((client) => client.system.authConfig()),
    listApplications: () => run((client) => client.applications.list()),
    createApplication: (payload: CreateApplication) =>
      run((client) => client.applications.create({ payload })),
    updateApplication: (id: string, payload: UpdateApplication) =>
      run((client) => client.applications.update({ params: { id }, payload })),
    deleteApplication: (id: string) =>
      run((client) => client.applications.delete({ params: { id } })),
  };
}

export type ApiClient = ReturnType<typeof makeApiClient>;
