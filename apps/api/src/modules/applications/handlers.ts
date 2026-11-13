import { and, desc, eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { ApplicationNotFound, CurrentUser, RoundtableApi } from '@roundtable/contract';
import { Database } from '../../platform/database/effect.js';
import { applications } from './schema.js';

/**
 * Every query filters on the signed-in user (CurrentUser, from the Authorization middleware).
 * Another user's row and a missing row are the same 404, so the API never confirms an id exists.
 * Database failures are defects: a 500, reported to Sentry with the redaction in
 * platform/observability/redact.ts.
 */
export const ApplicationsLive = HttpApiBuilder.group(
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
