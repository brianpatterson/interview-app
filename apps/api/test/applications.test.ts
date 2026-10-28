import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { Application } from '@interview-app/shared';
import { buildApp } from '../src/app.js';
import { createDb } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';

const { db, pool } = createDb(
  process.env.TEST_DATABASE_URL ?? 'postgres://app:app@localhost:5432/app_test',
);
const app = buildApp(db, { logger: false });

beforeAll(async () => {
  await runMigrations(db);
});

beforeEach(async () => {
  await db.execute(sql`truncate table applications`);
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

async function create(body: object) {
  const res = await app.inject({ method: 'POST', url: '/api/applications', payload: body });
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

  it('rejects invalid input', async () => {
    const { res } = await create({ company: '', jobTitle: 'SWE', jobUrl: 'not a url' });
    expect(res.statusCode).toBe(400);
  });

  it('lists applications most recently updated first', async () => {
    const { json: first } = await create({ company: 'First', jobTitle: 'SWE' });
    await create({ company: 'Second', jobTitle: 'SWE' });
    await app.inject({
      method: 'PATCH',
      url: `/api/applications/${first.id}`,
      payload: { status: 'screening' },
    });

    const res = await app.inject({ method: 'GET', url: '/api/applications' });
    expect(res.json<Application[]>().map((a) => a.company)).toEqual(['First', 'Second']);
  });

  it('updates status and bumps updatedAt', async () => {
    const { json: created } = await create({ company: 'Acme', jobTitle: 'SWE' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/applications/${created.id}`,
      payload: { status: 'interviewing' },
    });
    const updated = res.json<Application>();
    expect(res.statusCode).toBe(200);
    expect(updated.status).toBe('interviewing');
    expect(new Date(updated.updatedAt) > new Date(created.updatedAt)).toBe(true);
    expect(updated.createdAt).toBe(created.createdAt);
  });

  it('rejects an unknown status', async () => {
    const { json: created } = await create({ company: 'Acme', jobTitle: 'SWE' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/applications/${created.id}`,
      payload: { status: 'ghosted' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('deletes an application', async () => {
    const { json: created } = await create({ company: 'Acme', jobTitle: 'SWE' });
    const del = await app.inject({ method: 'DELETE', url: `/api/applications/${created.id}` });
    expect(del.statusCode).toBe(204);
    const get = await app.inject({ method: 'GET', url: `/api/applications/${created.id}` });
    expect(get.statusCode).toBe(404);
  });

  it('returns 404 for unknown or malformed ids', async () => {
    const unknown = await app.inject({
      method: 'GET',
      url: '/api/applications/00000000-0000-4000-8000-000000000000',
    });
    const malformed = await app.inject({ method: 'GET', url: '/api/applications/abc' });
    expect(unknown.statusCode).toBe(404);
    expect(malformed.statusCode).toBe(404);
  });
});
