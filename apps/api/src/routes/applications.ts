import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { createApplicationSchema, updateApplicationSchema } from '@interview-app/shared';
import type { Db } from '../db/index.js';
import { applications } from '../db/schema.js';

const idParams = z.object({ id: z.uuid() });

export function applicationRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/applications', async () => {
    return db.select().from(applications).orderBy(desc(applications.updatedAt));
  });

  app.get('/api/applications/:id', async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.code(404).send({ error: 'Not found' });
    const [row] = await db.select().from(applications).where(eq(applications.id, params.data.id));
    if (!row) return reply.code(404).send({ error: 'Not found' });
    return row;
  });

  app.post('/api/applications', async (req, reply) => {
    const body = createApplicationSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: z.treeifyError(body.error) });
    const [row] = await db.insert(applications).values(body.data).returning();
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
      .where(eq(applications.id, params.data.id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'Not found' });
    return row;
  });

  app.delete('/api/applications/:id', async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.code(404).send({ error: 'Not found' });
    const [row] = await db
      .delete(applications)
      .where(eq(applications.id, params.data.id))
      .returning({ id: applications.id });
    if (!row) return reply.code(404).send({ error: 'Not found' });
    return reply.code(204).send();
  });
}
