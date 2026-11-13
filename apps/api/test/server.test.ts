// The production wiring (serverLayer: the API on a real Node HTTP server), not the web handler the
// other tests use. A layer provided in the wrong place passed every other test yet sent request
// logs to the console unredacted under the real server, so this checks the real one.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ErrorEvent } from '@sentry/node';
import { Effect, Fiber, Layer, Redacted, Schema } from 'effect';
import { createServer } from 'node:net';
import { serverLayer } from '../src/server.js';
import { createDb } from '../src/platform/database/promise.js';
import {
  initErrorTracking,
  scrubEvent,
  Sentry,
} from '../src/platform/observability/error-tracking.js';
import { createLogger } from '../src/platform/observability/logging.js';
import { env, setupTestApp, signUp } from './helpers.js';

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer();

    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Finite }))(
        probe.address(),
      );

      probe.close(() => resolve(port));
    });
  });

describe('the production server (serverLayer)', () => {
  const events: ErrorEvent[] = [];
  const lines: string[] = [];

  const consoleOutput = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  );

  // Sign in on a working database, then serve with an unreachable one: the session lookup fails.
  const t = setupTestApp();
  const deadUrl = Redacted.make('postgres://app:app@localhost:1/nowhere');
  const dead = createDb(deadUrl);
  let cookie = '';
  let token = '';
  let base = '';
  let server: Fiber.Fiber<never, unknown> | undefined;

  beforeAll(async () => {
    initErrorTracking(
      { ...env, SENTRY_DSN: Redacted.make('https://public@o0.ingest.sentry.io/0') },
      {
        beforeSend: (event, hint) => {
          events.push(scrubEvent(event, hint));

          return null;
        },
      },
    );
    await t.migrate();
    await t.reset();
    ({ cookie } = await signUp(t));
    token = decodeURIComponent(cookie.match(/session_token=([^;.]+)/)?.[1] ?? '');

    const port = await freePort();

    base = `http://127.0.0.1:${port}`;
    server = Effect.runFork(
      Layer.launch(
        serverLayer({
          env: { ...env, DATABASE_URL: deadUrl },
          db: dead.db,
          log: createLogger({ stream: { write: (line) => void lines.push(line) } }),
          port,
          host: '127.0.0.1',
        }),
      ),
    );

    for (let attempt = 0; attempt < 50; attempt++) {
      if (
        await fetch(`${base}/api/health`).then(
          () => true,
          () => false,
        )
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error('server did not start');
  });

  afterAll(async () => {
    if (server) await Effect.runPromise(Fiber.interrupt(server));

    for (const spy of consoleOutput) spy.mockRestore();
    await dead.pool.end();
    await t.close();
    await Sentry.close();
  });

  it('logs every line, request logs included, as redacted JSON, and reports the failure', async () => {
    const res = await fetch(`${base}/api/applications`, { headers: { cookie } });

    expect(res.status).toBe(500);
    await Sentry.flush(2000);

    expect(token).not.toBe('');
    // Every line is pino JSON: nothing went to Effect's own console logger.
    expect(lines.length).toBeGreaterThan(0);

    for (const line of lines) expect(JSON.parse(line)).toHaveProperty('level');
    expect(lines.some((line) => line.includes('"http.status":500'))).toBe(true);
    expect(lines.join('')).not.toContain(token);
    expect(consoleOutput.flatMap((spy) => spy.mock.calls)).toEqual([]);

    // Our ErrorReporter saw the failure inside request handling (its top error is the session
    // lookup's Effect.tryPromise wrapper), with the redaction applied.
    const reported = events.find((e) => e.exception?.values?.at(-1)?.type === 'UnknownError');

    expect(reported).toBeDefined();

    // What's sent: Sentry deletes sdkProcessingMetadata before building the envelope
    // (@sentry/core createEventEnvelope). It holds the raw incoming request, cookie included,
    // for the SDK's own processing; event.request is what Sentry receives, and it's scrubbed.
    if (!reported) throw new Error('no event from our reporter');
    const { sdkProcessingMetadata: _internal, ...sent } = reported;

    expect(JSON.stringify(sent)).not.toContain(token);
    expect(JSON.stringify(sent.request ?? {})).not.toContain('session_token');
  });
});
