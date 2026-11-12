import { NodeRuntime } from '@effect/platform-node';
import { Effect, Layer } from 'effect';
import { serverLayer } from './app.js';
import { createDb } from './db/index.js';
import { loadEnv } from './env.js';
import { initErrorTracking, Sentry } from './error-tracking.js';
import { createLogger } from './logging.js';

const env = loadEnv();

initErrorTracking(env);

const log = createLogger();
const { db, pool } = createDb(env.DATABASE_URL);

// Released last: once the server has stopped and in-flight requests have finished, close the
// Promise pool (Better Auth, email limits) and send any queued error reports.
const Cleanup = Layer.effectDiscard(
  Effect.addFinalizer(() =>
    Effect.promise(async () => {
      log.info('Shutting down');
      await pool.end();
      await Sentry.close(2000);
    }),
  ),
);

const Server = serverLayer({ env, db, log, port: env.API_PORT }).pipe(Layer.provide(Cleanup));

// Docker sends SIGTERM on stop and deploy: runMain interrupts the server, which stops accepting
// connections and lets in-flight requests finish before the layers above are released.
Layer.launch(Server).pipe(NodeRuntime.runMain);
