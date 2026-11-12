import { Effect } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { HttpApiClient } from 'effect/http-api';
import { Api } from '../src/Api.js';

export const listApplications = () =>
  Effect.runPromise(
    HttpApiClient.make(Api).pipe(
      Effect.flatMap((client) => client.applications.list()),
      Effect.provide(FetchHttpClient.layer),
    ),
  );
