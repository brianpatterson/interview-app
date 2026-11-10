import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { fromNodeHeaders } from 'better-auth/node';
import { z } from 'zod';
import { createApplicationSchema, updateApplicationSchema } from '@roundtable/shared';
import type { Auth } from '../auth.js';
import type { Db } from '../db/index.js';
import { applications } from '../db/schema.js';

const idParams = z.object({ id: z.uuid() });

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
}

export async function applicationRoutes(app: FastifyInstance, db: Db, auth: Auth) {
  app.decorateRequest('userId', '');

  // Every route below requires a session. Other users' rows are reported as 404, not 403, so
  // the API never confirms that someone else's id exists.
  app.addHook('preHandler', async (req, reply) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });

    if (!session) return reply.code(401).send({ error: 'Not signed in' });
    req.userId = session.user.id;
  });

  const ownedBy = (userId: string, id: string) =>
    and(eq(applications.id, id), eq(applications.userId, userId));

  app.get('/api/applications', async (req) => {
    return db
      .select()
      .from(applications)
      .where(eq(applications.userId, req.userId))
      .orderBy(desc(applications.updatedAt));
  });

  app.get('/api/applications/:id', async (req, reply) => {
    const params = idParams.safeParse(req.params);

    if (!params.success) return reply.code(404).send({ error: 'Not found' });
    const [row] = await db.select().from(applications).where(ownedBy(req.userId, params.data.id));

    if (!row) return reply.code(404).send({ error: 'Not found' });

    return row;
  });

  app.post('/api/applications', async (req, reply) => {
    const body = createApplicationSchema.safeParse(req.body);

    if (!body.success) return reply.code(400).send({ error: z.treeifyError(body.error) });

    const [row] = await db
      .insert(applications)
      .values({ ...body.data, userId: req.userId })
      .returning();

    return reply.code(201).send(row);
  });

  app.patch('/api/applications/:id', async (req, reply) => {
    const params = idParams.safeParse(req.params);

    if (!params.success) return reply.code(404).send({ error: 'Not found' });
    const body = updateApplicationSchema.safeParse(req.body);

    if (!body.success) return reply.code(400).send({ error: z.treeifyError(body.error) });

    const [row] = await db
      .update(applications)
      .set(body.data)
      .where(ownedBy(req.userId, params.data.id))
      .returning();

    if (!row) return reply.code(404).send({ error: 'Not found' });

    return row;
  });

  app.delete('/api/applications/:id', async (req, reply) => {
    const params = idParams.safeParse(req.params);

    if (!params.success) return reply.code(404).send({ error: 'Not found' });

    const [row] = await db
      .delete(applications)
      .where(ownedBy(req.userId, params.data.id))
      .returning({ id: applications.id });

    if (!row) return reply.code(404).send({ error: 'Not found' });

    return reply.code(204).send();
  });
}
