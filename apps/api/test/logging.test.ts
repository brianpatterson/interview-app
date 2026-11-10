import { DrizzleQueryError } from 'drizzle-orm/errors';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { createDb } from '../src/db/index.js';
import { serializeError } from '../src/logging.js';
import { redactQueryParamsInJson } from '../src/redact.js';
import { env, setupTestApp, signUp } from './helpers.js';

// Drizzle's query error message ends with the query's parameters, and Better Auth looks sessions
// up by the raw token. These tests take the database away mid-session and read every line the
// server would write to its logs (and the console, where Better Auth logs by default).
describe('server logs during a database outage', () => {
  const t = setupTestApp();
  const dead = createDb('postgres://app:app@localhost:1/nowhere');
  const lines: string[] = [];

  const broken = buildApp(dead.db, env, {
    logStream: { write: (line) => void lines.push(line) },
    sendEmail: async () => {},
  });

  const consoleOutput = vi.spyOn(console, 'error').mockImplementation(() => {});

  beforeAll(async () => {
    await t.migrate();
    await t.reset();
  });
  afterAll(async () => {
    consoleOutput.mockRestore();
    await broken.close();
    await dead.pool.end();
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
    expect(logs).toContain('params: [redacted]');
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
      'Failed to get session: Failed query: select 1 where token = $1\nparams: secret-token: ECONNREFUSED',
    );
    expect(serialized.stack).toContain('caused by: Error: Failed query');
    expect(Object.keys(serialized)).toEqual(['type', 'message', 'stack']);
    expect(
      JSON.stringify(serializeError(new DrizzleQueryError('select 1', ['secret-token']))),
    ).not.toContain('"params"');
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
    expect(JSON.parse(redacted)).toEqual({
      msg: 'Failed query: select "token" from "sessions" where "token" = $1\nparams: [redacted]',
      err: {
        stack:
          'Error: Failed query: select 1\nparams: [redacted]\n    at NodePgPreparedQuery (session.js:41:11)',
      },
      other: 'untouched',
    });
  });
});
