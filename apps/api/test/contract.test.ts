// The Effect HttpApi contract (packages/shared/src/api.ts) must describe the API that runs today,
// until it replaces it (ADR-0022, steps 4–5). These tests keep the two schema sets from drifting:
// same inputs accepted and rejected, real responses decode, same endpoints.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErrorReporter, Exit, Schema } from 'effect';
import { HttpApi } from 'effect/http-api';
import * as contract from '@roundtable/shared/api';
import {
  applicationSchema,
  createApplicationSchema,
  updateApplicationSchema,
} from '@roundtable/shared';
import { z } from 'zod';
import { setupTestApp, signUp } from './helpers.js';

const long = (n: number) => 'x'.repeat(n);

describe('Effect and Zod schemas accept and reject the same input', () => {
  const createCases = {
    minimal: { company: 'Acme', jobTitle: 'SWE' },
    'trims text': { company: '  Acme  ', jobTitle: ' SWE ' },
    'https url': { company: 'A', jobTitle: 'B', jobUrl: 'https://example.com/jobs/1' },
    'http url': { company: 'A', jobTitle: 'B', jobUrl: 'http://example.com' },
    'null url': { company: 'A', jobTitle: 'B', jobUrl: null },
    status: { company: 'A', jobTitle: 'B', status: 'offer' },
    '200 chars': { company: long(200), jobTitle: long(200) },
    'unknown key is dropped': { company: 'A', jobTitle: 'B', extra: true },
    'empty company': { company: '', jobTitle: 'B' },
    'blank company': { company: '   ', jobTitle: 'B' },
    '201 chars': { company: long(201), jobTitle: 'B' },
    'missing jobTitle': { company: 'A' },
    'number company': { company: 5, jobTitle: 'B' },
    'javascript url': { company: 'A', jobTitle: 'B', jobUrl: 'javascript:alert(1)' },
    'data url': { company: 'A', jobTitle: 'B', jobUrl: 'data:text/html,x' },
    'ftp url': { company: 'A', jobTitle: 'B', jobUrl: 'ftp://x.y' },
    'not a url': { company: 'A', jobTitle: 'B', jobUrl: 'not a url' },
    '2001-char url': { company: 'A', jobTitle: 'B', jobUrl: `https://e.com/${long(1987)}` },
    'unknown status': { company: 'A', jobTitle: 'B', status: 'ghosted' },
  };

  const updateCases = {
    status: { status: 'offer' },
    'trims company': { company: '  Acme ' },
    'clears url': { jobUrl: null },
    empty: {},
    'only unknown keys': { extra: 1 },
    'empty company': { company: '' },
    'data url': { jobUrl: 'data:text/html,x' },
  };

  const idCases = {
    'v4 uuid': '00000000-0000-4000-8000-000000000000',
    'random uuid': crypto.randomUUID(),
    'uppercase uuid': crypto.randomUUID().toUpperCase(),
    'not a uuid': 'abc',
    'too short': '00000000-0000-4000-8000-00000000000',
  };

  it.each(Object.entries(createCases))('create: %s', (_name, input) => {
    const zod = createApplicationSchema.safeParse(input);

    expect(Exit.isSuccess(Schema.decodeUnknownExit(contract.CreateApplication)(input))).toBe(
      zod.success,
    );

    if (zod.success) {
      expect(Schema.decodeUnknownSync(contract.CreateApplication)(input)).toEqual(zod.data);
    }
  });

  it.each(Object.entries(updateCases))('update: %s', (_name, input) => {
    const zod = updateApplicationSchema.safeParse(input);

    expect(Exit.isSuccess(Schema.decodeUnknownExit(contract.UpdateApplication)(input))).toBe(
      zod.success,
    );

    if (zod.success) {
      expect(Schema.decodeUnknownSync(contract.UpdateApplication)(input)).toEqual(zod.data);
    }
  });

  const effectId = Schema.Struct({ id: Schema.String.check(Schema.isUUID()) });

  it.each(Object.entries(idCases))('id: %s', (_name, id) => {
    expect(Exit.isSuccess(Schema.decodeExit(effectId)({ id }))).toBe(
      z.uuid().safeParse(id).success,
    );
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

    const id = applicationSchema.parse(created.json()).id;

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
