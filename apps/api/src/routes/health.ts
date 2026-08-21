import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health/live', async () => ({
    status: 'ok',
    service: 'nexus-api',
    timestamp: new Date().toISOString(),
  }));

  app.get('/health/ready', async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return {
        status: 'ready',
        database: 'ok',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      app.log.error({ err: error }, 'Database readiness check failed');
      return reply.code(503).send({
        status: 'not_ready',
        database: 'unavailable',
        timestamp: new Date().toISOString(),
      });
    }
  });
}
