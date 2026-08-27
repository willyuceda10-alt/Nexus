import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { config } from './config.js';
import { registerRequestContext } from './auth.js';
import { ProjectScheduleV2ValidationError } from './domain/project-schedule-v2.js';
import { registerHierarchyWriteGuards } from './hierarchy-guard.js';
import { authorizationV2Routes } from './routes/authorization-v2.js';
import { automationActionsV2Routes } from './routes/automation-actions-v2.js';
import { automationV1Routes } from './routes/automation-v1.js';
import { baselineRoutes } from './routes/baselines.js';
import { bootstrapRoutes } from './routes/bootstrap.js';
import { costOperationsV2Routes } from './routes/cost-operations-v2.js';
import { costOverviewV2Routes } from './routes/cost-overview-v2.js';
import { dependencyRoutes } from './routes/dependencies.js';
import { forecastRoutes } from './routes/forecast.js';
import { healthRoutes } from './routes/health.js';
import { inboxV1Routes } from './routes/inbox-v1.js';
import { materialMasterV2Routes } from './routes/material-master-v2.js';
import { materialOperationsV2Routes } from './routes/material-operations-v2.js';
import { materialOverviewV2Routes } from './routes/material-overview-v2.js';
import { meRoutes } from './routes/me.js';
import { notificationCapabilitiesV1Routes } from './routes/notification-capabilities-v1.js';
import { notificationPreferencesV1Routes } from './routes/notification-preferences-v1.js';
import { objectRoutes } from './routes/objects.js';
import { outboxAdminV2Routes } from './routes/outbox-admin-v2.js';
import { projectEngineV2BackfillRoutes } from './routes/project-engine-v2-backfill.js';
import { projectScheduleV2Routes } from './routes/project-schedule-v2.js';
import { resourceCapacityRoutes } from './routes/resource-capacity.js';
import { scheduleAnalysisRoutes } from './routes/schedule-analysis.js';
import { scheduleAnalysisV2Routes } from './routes/schedule-analysis-v2.js';
import { sessionRoutes } from './routes/session.js';
import { wbsV2Routes } from './routes/wbs-v2.js';
import { workCalendarV2Routes } from './routes/work-calendars-v2.js';
import { workOsBoardComputedV1Routes } from './routes/work-os-board-computed-v1.js';
import { workOsBoardConfigOptionsV1Routes } from './routes/work-os-board-config-options-v1.js';
import { workOsBoardEditorV1Routes } from './routes/work-os-board-editor-v1.js';
import { workOsBoardManagedOptionCellsV1Routes } from './routes/work-os-board-managed-option-cells-v1.js';
import { workOsBoardManagedOptionsV1Routes } from './routes/work-os-board-managed-options-v1.js';
import { workOsBoardsV1Routes } from './routes/work-os-boards-v1.js';

type PrismaWrappedDatabaseError = FastifyError & {
  meta?: { code?: string; message?: string };
};

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: {
        paths: [
          'req.headers.authorization',
          'request.headers.authorization',
          'headers.authorization',
        ],
        censor: '[REDACTED]',
      },
    },
    requestIdHeader: 'x-correlation-id',
    genReqId: (request) => {
      const incoming = request.headers['x-correlation-id'];
      return typeof incoming === 'string' && incoming.length <= 128
        ? incoming
        : randomUUID();
    },
    bodyLimit: 1_048_576,
  });

  registerRequestContext(app);

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || config.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin not allowed by Bridata Project CORS policy'), false);
    },
    credentials: true,
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-correlation-id', request.id);
    return payload;
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ProjectScheduleV2ValidationError) {
      request.log.info({ err: error }, 'Project Engine V2 validation rejected request');
      void reply.code(400).send({
        error: 'invalid_project_schedule',
        message: error.message,
        correlationId: request.id,
      });
      return;
    }

    const dbError = error as PrismaWrappedDatabaseError;
    const postgresCode = dbError.code === 'P2010' ? dbError.meta?.code : dbError.code;
    if (postgresCode === 'P0001') {
      request.log.info({ err: error }, 'Bridata domain integrity guard rejected request');
      void reply.code(409).send({
        error: 'domain_integrity_conflict',
        message: dbError.meta?.message || error.message,
        correlationId: request.id,
      });
      return;
    }

    request.log.error({ err: error }, 'Unhandled Bridata Project API error');
    const statusCode = error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
    void reply.code(statusCode).send({
      error: statusCode >= 500 ? 'internal_error' : 'request_error',
      message: statusCode >= 500 ? 'An unexpected error occurred.' : error.message,
      correlationId: request.id,
    });
  });

  registerHierarchyWriteGuards(app);

  await app.register(healthRoutes);
  await app.register(sessionRoutes);
  await app.register(meRoutes);
  await app.register(authorizationV2Routes);
  await app.register(outboxAdminV2Routes);
  await app.register(automationV1Routes);
  await app.register(automationActionsV2Routes);
  await app.register(inboxV1Routes);
  await app.register(notificationPreferencesV1Routes);
  await app.register(notificationCapabilitiesV1Routes);
  await app.register(bootstrapRoutes);
  await app.register(objectRoutes);
  await app.register(workOsBoardsV1Routes);
  await app.register(workOsBoardEditorV1Routes);
  await app.register(workOsBoardConfigOptionsV1Routes);
  await app.register(workOsBoardManagedOptionsV1Routes);
  await app.register(workOsBoardManagedOptionCellsV1Routes);
  await app.register(workOsBoardComputedV1Routes);
  await app.register(dependencyRoutes);
  await app.register(scheduleAnalysisRoutes);
  await app.register(projectScheduleV2Routes);
  await app.register(workCalendarV2Routes);
  await app.register(scheduleAnalysisV2Routes);
  await app.register(projectEngineV2BackfillRoutes);
  await app.register(wbsV2Routes);
  await app.register(materialMasterV2Routes);
  await app.register(materialOperationsV2Routes);
  await app.register(materialOverviewV2Routes);
  await app.register(costOperationsV2Routes);
  await app.register(costOverviewV2Routes);
  await app.register(forecastRoutes);
  await app.register(resourceCapacityRoutes);
  await app.register(baselineRoutes);

  return app;
}