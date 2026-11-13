// The Effect HttpApi contract (packages/contract) is the only schema for the API: the
// server decodes requests with it and the web client encodes them with it (ADR-0022). These tests
// pin down what it accepts, that real responses decode, and that it lists the routes served.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErrorReporter, Exit, Schema } from 'effect';
import { HttpApi } from 'effect/http-api';
import * as contract from '@roundtable/contract';
import { setupTestApp, signUp } from './helpers.js';

const long = (n: number) => 'x'.repeat(n);

type Case = [input: unknown, decoded: object | false];

// Each case: the input, and what it decodes to (or `false` when it's rejected). These began as
// the Zod parity cases from step 3, so they're what the API accepted before the Effect contract.
describe('what the contract accepts', () => {
  const minimal = { company: 'A', jobTitle: 'B' };

  const createCases = {
    minimal: [
      { company: 'Acme', jobTitle: 'SWE' },
      { company: 'Acme', jobTitle: 'SWE' },
    ],
    'trims text': [
      { company: '  Acme  ', jobTitle: ' SWE ' },
      { company: 'Acme', jobTitle: 'SWE' },
    ],
    'https url': [
      { ...minimal, jobUrl: 'https://example.com/jobs/1' },
      { ...minimal, jobUrl: 'https://example.com/jobs/1' },
    ],
    'http url': [
      { ...minimal, jobUrl: 'http://example.com' },
      { ...minimal, jobUrl: 'http://example.com' },
    ],
    'null url': [
      { ...minimal, jobUrl: null },
      { ...minimal, jobUrl: null },
    ],
    status: [
      { ...minimal, status: 'offer' },
      { ...minimal, status: 'offer' },
    ],
    '200 chars': [
      { company: long(200), jobTitle: long(200) },
      { company: long(200), jobTitle: long(200) },
    ],
    '200 chars once trimmed': [
      { company: ` ${long(200)} `, jobTitle: 'B' },
      { company: long(200), jobTitle: 'B' },
    ],
    'unknown key is dropped': [{ ...minimal, extra: true }, minimal],
    'empty company': [{ company: '', jobTitle: 'B' }, false],
    'blank company': [{ company: '   ', jobTitle: 'B' }, false],
    '201 chars': [{ company: long(201), jobTitle: 'B' }, false],
    'missing jobTitle': [{ company: 'A' }, false],
    'number company': [{ company: 5, jobTitle: 'B' }, false],
    'javascript url': [{ ...minimal, jobUrl: 'javascript:alert(1)' }, false],
    'data url': [{ ...minimal, jobUrl: 'data:text/html,x' }, false],
    'ftp url': [{ ...minimal, jobUrl: 'ftp://x.y' }, false],
    'not a url': [{ ...minimal, jobUrl: 'not a url' }, false],
    '2001-char url': [{ ...minimal, jobUrl: `https://e.com/${long(1987)}` }, false],
    'unknown status': [{ ...minimal, status: 'ghosted' }, false],
  } satisfies Record<string, Case>;

  const updateCases = {
    status: [{ status: 'offer' }, { status: 'offer' }],
    'trims company': [{ company: '  Acme ' }, { company: 'Acme' }],
    'clears url': [{ jobUrl: null }, { jobUrl: null }],
    empty: [{}, false],
    'only unknown keys': [{ extra: 1 }, false],
    'empty company': [{ company: '' }, false],
    'data url': [{ jobUrl: 'data:text/html,x' }, false],
  } satisfies Record<string, Case>;

  const idCases = {
    'v4 uuid': ['00000000-0000-4000-8000-000000000000', true],
    'random uuid': [crypto.randomUUID(), true],
    'uppercase uuid': [crypto.randomUUID().toUpperCase(), true],
    'not a uuid': ['abc', false],
    'too short': ['00000000-0000-4000-8000-00000000000', false],
  } satisfies Record<string, [id: string, valid: boolean]>;

  it.each(Object.entries(createCases))('create: %s', (_name, [input, decoded]) => {
    const exit = Schema.decodeUnknownExit(contract.CreateApplication)(input);

    if (decoded === false) expect(Exit.isFailure(exit)).toBe(true);
    else expect(exit).toEqual(Exit.succeed(decoded));
  });

  it.each(Object.entries(updateCases))('update: %s', (_name, [input, decoded]) => {
    const exit = Schema.decodeUnknownExit(contract.UpdateApplication)(input);

    if (decoded === false) expect(Exit.isFailure(exit)).toBe(true);
    else expect(exit).toEqual(Exit.succeed(decoded));
  });

  const IdParams = Schema.Struct({ id: Schema.String.check(Schema.isUUID()) });

  it.each(Object.entries(idCases))('id: %s', (_name, [id, valid]) => {
    expect(Exit.isSuccess(Schema.decodeExit(IdParams)({ id }))).toBe(valid);
  });

  // The typed client encodes request bodies before sending them, so text must trim on the way
  // out too: a form value of " Acme" is sent as "Acme" rather than refused in the browser.
  it('encodes text trimmed, and refuses blank text before it is sent', () => {
    const encode = Schema.encodeUnknownExit(contract.CreateApplication);

    expect(encode({ company: ' Acme ', jobTitle: 'SWE\n' })).toEqual(
      Exit.succeed({ company: 'Acme', jobTitle: 'SWE' }),
    );
    expect(Exit.isFailure(encode({ company: '  ', jobTitle: 'SWE' }))).toBe(true);
    expect(Exit.isFailure(encode({ company: long(201), jobTitle: 'SWE' }))).toBe(true);
  });
});

describe('real responses from the current API decode with the contract', () => {
  const t = setupTestApp();
  let cookie: string;

  beforeAll(() => t.migrate());
  beforeEach(async () => {
    await t.reset();
    ({ cookie } = await signUp(t));
  });
  afterAll(() => t.close());

  it('applications, health and auth-config', async () => {
    const created = await t.inject({
      method: 'POST',
      url: '/api/applications',
      headers: { cookie },
      payload: { company: 'Acme', jobTitle: 'SWE', jobUrl: 'https://example.com' },
    });

    const id = Schema.decodeUnknownSync(contract.Application)(created.json()).id;

    const list = await t.inject({
      method: 'GET',
      url: '/api/applications',
      headers: { cookie },
    });

    const one = await t.inject({
      method: 'GET',
      url: `/api/applications/${id}`,
      headers: { cookie },
    });

    const health = await t.inject({ method: 'GET', url: '/api/health' });
    const authConfig = await t.inject({ method: 'GET', url: '/api/auth-config' });

    const decoded = Schema.decodeUnknownSync(contract.Application)(created.json());

    expect(decoded.createdAt).toBeInstanceOf(Date);
    expect(decoded.createdAt.toISOString()).toBe(created.json<{ createdAt: string }>().createdAt);
    expect(() =>
      Schema.decodeUnknownSync(Schema.Array(contract.Application))(list.json()),
    ).not.toThrow();
    expect(() => Schema.decodeUnknownSync(contract.Application)(one.json())).not.toThrow();
    expect(() => Schema.decodeUnknownSync(contract.Health)(health.json())).not.toThrow();
    expect(() => Schema.decodeUnknownSync(contract.AuthConfig)(authConfig.json())).not.toThrow();
  });
});

describe('the contract matches the routes the server answers', () => {
  const t = setupTestApp();

  afterAll(() => t.close());

  it('same methods and paths, except Better Auth (mounted separately)', async () => {
    const served = await t.routes();

    const declared = new Set<string>();

    HttpApi.reflect(contract.RoundtableApi, {
      onGroup: () => {},
      onEndpoint: ({ endpoint }) => declared.add(`${endpoint.method} ${endpoint.path}`),
    });

    expect([...declared].sort()).toEqual(served);
  });
});

describe('expected errors stay out of Sentry', () => {
  // A new error class fails the first test until it's listed here and checked below. A 5xx error
  // is unexpected by definition and may be reported; a 4xx one must set ErrorReporter.ignore.
  it('lists every error class in the contract', () => {
    const errorClassNames = Object.entries(contract)
      .filter(([, value]) => value instanceof Function && value.prototype instanceof Error)
      .map(([name]) => name);

    expect(errorClassNames.sort()).toEqual(['ApplicationNotFound', 'Unauthorized']);
  });

  it('ApplicationNotFound (404) and Unauthorized (401) set ErrorReporter.ignore', () => {
    expect(new contract.ApplicationNotFound()[ErrorReporter.ignore]).toBe(true);
    expect(new contract.Unauthorized()[ErrorReporter.ignore]).toBe(true);
  });
});
