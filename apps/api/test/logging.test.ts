import { DrizzleQueryError } from 'drizzle-orm/errors';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { serializeError } from '../src/logging.js';
import { redactQueryParamsInJson } from '../src/redact.js';
import { users } from '../src/db/schema.js';
import { setupTestApp, signUp } from './helpers.js';

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

  const consoleOutput = vi.spyOn(console, 'error').mockImplementation(() => {});

  beforeAll(async () => {
    await t.migrate();
    await t.reset();
  });
  afterAll(async () => {
    consoleOutput.mockRestore();
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

    const consoleLogs = consoleOutput.mock.calls
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
