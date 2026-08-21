import type { FastifyInstance } from 'fastify';
import { authenticate, resolveActor } from '../auth.js';

export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/me',
    { preHandler: [authenticate, resolveActor] },
    async (request) => ({
      actor: request.actor,
    }),
  );
}
