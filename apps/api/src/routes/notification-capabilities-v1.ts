import type { FastifyInstance } from 'fastify';
import { authenticate, resolveActor } from '../auth.js';
import { config } from '../config.js';

export async function notificationCapabilitiesV1Routes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/notification-capabilities-v1', { preHandler: [authenticate, resolveActor] }, async () => ({
    graphDeliveryEnabled: config.M365_GRAPH_DELIVERY_ENABLED,
    outlookConfigured: Boolean(
      config.NOTIFICATION_WORKER_AVAILABLE
      && config.M365_GRAPH_DELIVERY_ENABLED
      && config.M365_OUTLOOK_SENDER_USER,
    ),
    teamsConfigured: Boolean(
      config.NOTIFICATION_WORKER_AVAILABLE
      && config.M365_GRAPH_DELIVERY_ENABLED
      && config.M365_TEAMS_ACTIVITY_TYPE
      && config.M365_TEAMS_TOPIC_WEB_URL,
    ),
    notificationWorkerEnabled: config.NOTIFICATION_WORKER_AVAILABLE,
  }));
}
