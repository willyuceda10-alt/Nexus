import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { config } from './config.js';
import { registerRequestContext } from './auth.js';
import {
  createConfiguredDocumentBinaryStoreV1,
  type DocumentBinaryStoreV1,
} from './document-binary-store-v1.js';
import { ProjectScheduleV2ValidationError } from './domain/project-schedule-v2.js';
import { registerHierarchyWriteGuards } from './hierarchy-guard.js';
import { authorizationV2Routes } from './routes/authorization-v2.js';
import { automationActionsV2Routes } from './routes/automation-actions-v2.js';
import { automationV1Routes } from './routes/automation-v1.js';
import { baselineRoutes } from './routes/baselines.js';
import { bootstrapRoutes } from './routes/bootstrap.js';
import { collaborationV1Routes } from './routes/collaboration-v1.js';
import { documentBinaryV1Routes } from './routes/document-binary-v1.js';
import { documentMetadataV1Routes } from './routes/document-metadata-v1.js';
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
import { meetingActionsV1Routes } from './routes/meeting-actions-v1.js';
import { meetingAvailabilityV1Routes } from './routes/meeting-availability-v1.js';
import { meetingCalendarProjectionV1Routes } from './routes/meeting-calendar-projection-v1.js';
import { meetingLifecycleV2Routes } from './routes/meeting-lifecycle-v2.js';
import { meetingPeopleV1Routes } from './routes/meeting-people-v1.js';
import { meetingResourceAvailabilityV1Routes } from './routes/meeting-resource-availability-v1.js';
import { meetingResourcesV1Routes } from './routes/meeting-resources-v1.js';
import { meetingSchedulingV2Routes } from './routes/meeting-scheduling-v2.js';
import { meetingsV1Routes } from './routes/meetings-v1.js';
import { recurringMeetingLifecycleV1Routes } from './routes/recurring-meeting-lifecycle-v1.js';
import { recurringMeetingsV1Routes } from './routes/recurring-meetings-v1.js';
import { notificationCapabilitiesV1Routes } from './routes/notification-capabilities-v1.js';
import { notificationPreferencesV1Routes } from './routes/notification-preferences-v1.js';
import { objectApprovalsV1Routes } from './routes/object-approvals-v1.js';
import { objectRelationsV1Routes } from './routes/object-relations-v1.js';
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
import { workOsBoardTemporalV1Routes } from './routes/work-os-board-temporal-v1.js';
import { workOsBoardsV1Routes } from './routes/work-os-boards-v1.js';

type PrismaWrappedDatabaseError = FastifyError & {
  meta?: { code?: string; message?: string };
};

type MeetingSchedulingV2PolicyBody = {
  requestM365Sync?: unknown;
  validateAvailability?: unknown;
};

export type BuildAppOptions = {
  documentBinaryStore?: DocumentBinaryStoreV1;
};

const legacyBoardOptionsPath = /^\/api\/v1\/work-os\/boards-v1\/[^/]+\/columns\/[^/]+\/options(?:\?|$)/;
const meetingSchedulingV2Path = /^\/api\/v1\/meetings-v2\/schedule(?:\?|$)/;

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const documentBinaryStore = options.documentBinaryStore ?? createConfiguredDocumentBinaryStoreV1();
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
      return typeof incoming === 'string' && incoming.length <= 128 ? incoming : randomUUID();
    },
    bodyLimit: 1_048_576,
  });

  registerRequestContext(app);
  await app.register(helmet, { contentSecurityPolicy: false });
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
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: config.DOCUMENT_MAX_FILE_BYTES },
    (_request, body, done) => done(null, body),
  );

  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'PUT' && legacyBoardOptionsPath.test(request.raw.url ?? '')) {
      return reply.code(410).send({
        error: 'legacy_board_options_endpoint_disabled',
        message: 'Use the governed managed-options endpoint instead.',
        correlationId: request.id,
      });
    }
  });

  app.addHook('preValidation', async (request, reply) => {
    if (request.method !== 'POST' || !meetingSchedulingV2Path.test(request.raw.url ?? '')) return;
    const body = request.body as MeetingSchedulingV2PolicyBody | null | undefined;
    if (body?.requestM365Sync === true && body.validateAvailability === false) {
      return reply.code(400).send({
        error: 'm365_sync_requires_availability_validation',
        message: 'Meeting Scheduling V2 requires availability validation when Outlook/M365 synchronization is requested.',
        correlationId: request.id,
      });
    }
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-correlation-id', request.id);
    return payload;
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ProjectScheduleV2ValidationError) {
      request.log.info({ err: error }, 'Project Engine V2 validation rejected request');
      void reply.code(400).send({ error: 'invalid_project_schedule', message: error.message, correlationId: request.id });
      return;
    }
    const dbError = error as PrismaWrappedDatabaseError;
    const postgresCode = dbError.code === 'P2010' ? dbError.meta?.code : dbError.code;
    if (postgresCode === 'P0001') {
      request.log.info({ err: error }, 'Bridata domain integrity guard rejected request');
      void reply.code(409).send({ error: 'domain_integrity_conflict', message: dbError.meta?.message || error.message, correlationId: request.id });
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
  await app.register(collaborationV1Routes);
  await app.register(documentMetadataV1Routes);
  await documentBinaryV1Routes(app, documentBinaryStore);
  await app.register(objectRelationsV1Routes);
  await app.register(objectApprovalsV1Routes);
  await app.register(meetingsV1Routes);
  await app.register(meetingPeopleV1Routes);
  await app.register(meetingAvailabilityV1Routes);
  await app.register(meetingCalendarProjectionV1Routes);
  await app.register(meetingResourceAvailabilityV1Routes);
  await app.register(meetingResourcesV1Routes);
  await app.register(meetingSchedulingV2Routes);
  await app.register(meetingLifecycleV2Routes);
  await app.register(recurringMeetingsV1Routes);
  await app.register(recurringMeetingLifecycleV1Routes);
  await app.register(meetingActionsV1Routes);
  await app.register(workOsBoardsV1Routes);
  await app.register(workOsBoardEditorV1Routes);
  await app.register(workOsBoardConfigOptionsV1Routes);
  await app.register(workOsBoardManagedOptionsV1Routes);
  await app.register(workOsBoardManagedOptionCellsV1Routes);
  await app.register(workOsBoardComputedV1Routes);
  await app.register(workOsBoardTemporalV1Routes);
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
