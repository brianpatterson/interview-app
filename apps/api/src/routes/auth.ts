import type { FastifyInstance } from 'fastify';
import type { Auth, AuthProvider } from '../auth.js';

/** Bridges Fastify to Better Auth's Fetch-API handler for everything under /api/auth. */
export function authRoutes(app: FastifyInstance, auth: Auth, providers: AuthProvider[]) {
  app.get('/api/auth-config', async () => ({ providers }));

  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    async handler(req, reply) {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value !== undefined) headers.append(key, String(value));
      }
      const url = new URL(req.url, `${req.protocol}://${req.host}`);
      const response = await auth.handler(
        new Request(url, {
          method: req.method,
          headers,
          body: req.body === undefined ? undefined : JSON.stringify(req.body),
        }),
      );

      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key !== 'set-cookie') reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) reply.header('set-cookie', cookies);
      return reply.send(response.body ? await response.text() : null);
    },
  });
}
