import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applicationSchema, type Application } from '@roundtable/shared';
import type { InjectOptions } from 'fastify';
import { setupTestApp, signUp } from './helpers.js';

const t = setupTestApp();
const { app } = t;
let cookie: string;

beforeAll(() => t.migrate());

beforeEach(async () => {
  await t.reset();
  ({ cookie } = await signUp(t));
});

afterAll(() => t.close());

afterEach(() => vi.useRealTimers());

// Raw request bodies, deliberately untyped by the contract: several tests send invalid input.
type Payload = InjectOptions['payload'];

function request(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: Payload) {
  return app.inject({ method, url, payload, headers: { cookie } });
}

async function create(body: Payload) {
  const res = await request('POST', '/api/applications', body);

  return { res, json: res.json<Application>() };
}

describe('applications API', () => {
  it('creates an application with default status and timestamps', async () => {
    const { res, json } = await create({ company: 'Acme', jobTitle: 'Software Engineer' });
    expect(res.statusCode).toBe(201);
    expect(json).toMatchObject({
      company: 'Acme',
      jobTitle: 'Software Engineer',
      jobUrl: null,
      status: 'applied',
    });
    expect(json.createdAt).toBe(json.updatedAt);
  });

  it('returns bodies that match the shared contract', async () => {
    const { json: created } = await create({ company: 'Acme', jobTitle: 'SWE' });
    const list = await request('GET', '/api/applications');
    const updated = await request('PATCH', `/api/applications/${created.id}`, { status: 'offer' });

    // The web client parses every response with these schemas, so a mismatch would break it.
    expect(() => applicationSchema.parse(created)).not.toThrow();
    expect(() => applicationSchema.array().parse(list.json())).not.toThrow();
    expect(() => applicationSchema.parse(updated.json())).not.toThrow();
  });

  it('rejects invalid input', async () => {
    const { res } = await create({ company: '', jobTitle: 'SWE', jobUrl: 'not a url' });
    expect(res.statusCode).toBe(400);
  });

  it('lists applications most recently updated first', async () => {
    const { json: first } = await create({ company: 'First', jobTitle: 'SWE' });
    await create({ company: 'Second', jobTitle: 'SWE' });
    await request('PATCH', `/api/applications/${first.id}`, { status: 'screening' });

    const res = await request('GET', '/api/applications');
    expect(res.json<Application[]>().map((a) => a.company)).toEqual(['First', 'Second']);
  });

  it('updates status and bumps updatedAt', async () => {
    const { json: created } = await create({ company: 'Acme', jobTitle: 'SWE' });

    const res = await request('PATCH', `/api/applications/${created.id}`, {
      status: 'interviewing',
    });

    const updated = res.json<Application>();
    expect(res.statusCode).toBe(200);
    expect(updated.status).toBe('interviewing');
    expect(new Date(updated.updatedAt) > new Date(created.updatedAt)).toBe(true);
    expect(updated.createdAt).toBe(created.createdAt);
  });

  it('bumps updatedAt even when the API clock is behind the database clock', async () => {
    const { json: created } = await create({ company: 'Acme', jobTitle: 'SWE' });

    // Clocks on different machines (or Docker Desktop's VM) drift apart. createdAt comes from
    // Postgres, so updatedAt must too, or an update can land "before" the row was created.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() - 60_000 });
    const res = await request('PATCH', `/api/applications/${created.id}`, { status: 'offer' });
    vi.useRealTimers();

    const updated = res.json<Application>();
    expect(new Date(updated.updatedAt) > new Date(created.updatedAt)).toBe(true);
  });

  it('rejects an unknown status', async () => {
    const { json: created } = await create({ company: 'Acme', jobTitle: 'SWE' });
    const res = await request('PATCH', `/api/applications/${created.id}`, { status: 'ghosted' });
    expect(res.statusCode).toBe(400);
  });

  it('deletes an application', async () => {
    const { json: created } = await create({ company: 'Acme', jobTitle: 'SWE' });
    const del = await request('DELETE', `/api/applications/${created.id}`);
    expect(del.statusCode).toBe(204);
    const get = await request('GET', `/api/applications/${created.id}`);
    expect(get.statusCode).toBe(404);
  });

  it('returns 404 for unknown or malformed ids', async () => {
    const unknown = await request('GET', '/api/applications/00000000-0000-4000-8000-000000000000');
    const malformed = await request('GET', '/api/applications/abc');
    expect(unknown.statusCode).toBe(404);
    expect(malformed.statusCode).toBe(404);
  });
});
