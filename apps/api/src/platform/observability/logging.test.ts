import { DrizzleQueryError } from 'drizzle-orm/errors';
import { eq } from 'drizzle-orm';
import { Cause, Effect, Exit } from 'effect';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { serializeError } from './logging.js';
import { redactQueryParamsInJson } from './redact.js';
import { Database } from '../database/effect.js';
import { applications } from '../../modules/applications/index.js';
import { users } from '../../modules/identity/index.js';
import { env, setupTestApp, signUp } from '#test/helpers';

// Drizzle's query error message ends with the query's parameters, and Better Auth looks sessions
// up by the raw token. These tests take the database away mid-session and read every line the
// server would write to its logs (and the console, where Better Auth logs by default).
describe('server logs during a database outage', () => {
  const t = setupTestApp();
  const lines: string[] = [];

  const broken = setupTestApp({
    databaseUrl: 'postgres://app:app@localhost:1/nowhere',
    logStream: { write: (line) => void lines.push(line) },
  });

  // Every console method: anything that bypasses the logger (Effect's default logger writes
  // with console.log) must not carry the token either.
  const consoleOutput = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  );

  beforeAll(async () => {
    await t.migrate();
    await t.reset();
  });
  afterAll(async () => {
    for (const spy of consoleOutput) spy.mockRestore();
    await broken.close();
    await t.close();
  });

  it('logs the failed query without its parameters', async () => {
    const { cookie } = await signUp(t);
    const token = decodeURIComponent(cookie.match(/session_token=([^;.]+)/)?.[1] ?? '');
    expect(token).not.toBe('');

    const res = await broken.inject({
      method: 'GET',
      url: '/api/applications',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(500);

    const logs = lines.join('');

    const consoleLogs = consoleOutput
      .flatMap((spy) => spy.mock.calls)
      .flat()
      .map((arg) => (arg instanceof Error ? `${arg.message}\n${arg.stack}` : String(arg)))
      .join('\n');

    expect(logs).not.toContain(token);
    expect(consoleLogs).not.toContain(token);
    // Still useful: which query failed is logged, only the values are gone.
    expect(logs).toContain('Failed query: select');
    // The values' shapes are kept: an agent can still see what kind of value was passed.
    expect(logs).toContain(`params: <redacted: string(${token.length})>`);
    // Better Auth's own log line now goes through our logger, not the console.
    expect(logs).toContain('[Better Auth]');
  });
});

describe('serializeError', () => {
  it("keeps the message, stack and causes but not Drizzle's params property", () => {
    const err = new Error('Failed to get session', {
      cause: new DrizzleQueryError(
        'select 1 where token = $1',
        ['secret-token'],
        new Error('ECONNREFUSED'),
      ),
    });

    const serialized = serializeError(err);

    expect(serialized.type).toBe('Error');
    expect(serialized.message).toBe(
      'Failed to get session: Failed query: select 1 where token = $1\nparams: <redacted: string(12)>: ECONNREFUSED',
    );
    expect(serialized.stack).toContain('caused by: DrizzleQueryError: Failed query');
    expect(Object.keys(serialized)).toEqual(['type', 'message', 'stack']);
    expect(
      JSON.stringify(serializeError(new DrizzleQueryError('select 1', ['secret-token']))),
    ).not.toContain('"params"');
  });
});

describe('serializeError with a real Postgres error', () => {
  const t = setupTestApp();

  beforeAll(async () => {
    await t.migrate();
    await t.reset();
  });
  afterAll(() => t.close());

  it("keeps Postgres's diagnostic fields but not the values", async () => {
    const email = `dup-${crypto.randomUUID()}@example.com`;
    const row = { id: crypto.randomUUID(), name: 'Dup', email };
    await t.db.insert(users).values(row);

    const err = await t.db
      .insert(users)
      .values({ ...row, id: crypto.randomUUID() })
      .then(
        () => undefined,
        (error: Error) => error,
      );

    expect(err).toBeInstanceOf(Error);
    const serialized = serializeError(err!);

    expect(serialized.postgres).toEqual({
      code: '23505',
      severity: 'ERROR',
      schema: 'public',
      table: 'users',
      constraint: 'users_email_unique',
      routine: expect.any(String),
    });
    expect(serialized.message).toContain('params: <redacted: uuid, string(3), string(');
    // Postgres's `detail` ("Key (email)=(…) already exists") and the params hold the email.
    expect(JSON.stringify(serialized)).not.toContain(email);
  });
});

describe('serializeError with a query value Postgres rejects', () => {
  // A non-uuid compared with a uuid column: Postgres fails it as a data exception (22P02) and
  // quotes the rejected value in its own message, on either driver.
  const secret = 'not-a-uuid-but-a-secret-value';
  const t = setupTestApp();

  afterAll(() => t.close());

  const expectSafeAndUseful = (err: Error) => {
    const serialized = serializeError(err);

    expect(JSON.stringify(serialized)).not.toContain(secret);
    expect(serialized.message).toContain(`params: <redacted: string(${secret.length})>`);
    expect(serialized.message).toContain('invalid input syntax for type uuid: "<redacted>"');
    expect(serialized.postgres).toMatchObject({ code: '22P02', routine: 'string_to_uuid' });
  };

  it('Promise driver (pg)', async () => {
    const err = await t.db
      .select()
      .from(applications)
      .where(eq(applications.id, secret))
      .then(
        () => undefined,
        (error: Error) => error,
      );

    expect(err).toBeInstanceOf(Error);
    expectSafeAndUseful(err!);
  });

  it('Effect driver (@effect/sql-pg): the chain continues through the Effect Cause', async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const db = yield* Database;

        return yield* db.select().from(applications).where(eq(applications.id, secret));
      }).pipe(Effect.provide(Database.layer(env.DATABASE_URL))),
    );

    const err = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

    expect(err).toBeInstanceOf(Error);
    expectSafeAndUseful(err instanceof Error ? err : new Error('query did not fail'));
  });
});

describe('redactQueryParamsInJson', () => {
  it('redacts parameter values inside a log line and leaves the rest of the JSON intact', () => {
    const line = JSON.stringify({
      msg: 'Failed query: select "token" from "sessions" where "token" = $1\nparams: secret-token',
      err: {
        stack:
          'Error: Failed query: select 1\nparams: secret-token,"quoted"\n    at NodePgPreparedQuery (session.js:41:11)',
      },
      other: 'untouched',
    });

    const redacted = redactQueryParamsInJson(line);

    expect(redacted).not.toContain('secret-token');
    // Already described by the serializer: left alone.
    const described = JSON.stringify({ msg: 'Failed query: select 1\nparams: <redacted: uuid>' });
    expect(redactQueryParamsInJson(described)).toBe(described);
    expect(JSON.parse(redacted)).toEqual({
      msg: 'Failed query: select "token" from "sessions" where "token" = $1\nparams: <redacted>',
      err: {
        stack:
          'Error: Failed query: select 1\nparams: <redacted>\n    at NodePgPreparedQuery (session.js:41:11)',
      },
      other: 'untouched',
    });
  });
});
