import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
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

  app.get('/health/dependencies', async (_request, reply) => {
    let database: 'ok' | 'unavailable' = 'ok';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      database = 'unavailable';
      app.log.error({ err: error }, 'Dependency diagnostic database check failed');
    }

    const dependencies = {
      database,
      documentStorage: {
        mode: config.DOCUMENT_STORAGE_MODE,
        configured: config.DOCUMENT_STORAGE_MODE !== 'azure' || Boolean(config.AZURE_STORAGE_ACCOUNT_NAME),
      },
      integrationStorage: {
        mode: config.INTEGRATION_STORAGE_MODE,
        configured: config.INTEGRATION_STORAGE_MODE !== 'azure' || Boolean(config.AZURE_STORAGE_ACCOUNT_NAME),
      },
      serviceBus: {
        configured: Boolean(config.SERVICE_BUS_NAMESPACE),
        outboxWorkerEnabled: config.OUTBOX_WORKER_ENABLED,
        automationWorkerEnabled: config.AUTOMATION_WORKER_ENABLED,
        notificationWorkerEnabled: config.NOTIFICATION_WORKER_ENABLED,
      },
      m365: {
        graphDeliveryEnabled: config.M365_GRAPH_DELIVERY_ENABLED,
        availabilityEnabled: config.M365_AVAILABILITY_ENABLED,
        notificationWorkerAvailable: config.NOTIFICATION_WORKER_AVAILABLE,
      },
    };

    const status = database === 'ok' ? 'operational' : 'degraded';
    return reply.code(database === 'ok' ? 200 : 503).send({
      status,
      dependencies,
      timestamp: new Date().toISOString(),
    });
  });
}
