import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { config } from './config.js';
import { registerRequestContext } from './auth.js';
import { ProjectScheduleV2ValidationError } from './domain/project-schedule-v2.js';
import { registerHierarchyWriteGuards } from './hierarchy-guard.js';
import { baselineRoutes } from './routes/baselines.js';
import { bootstrapRoutes } from './routes/bootstrap.js';
import { dependencyRoutes } from './routes/dependencies.js';
import { forecastRoutes } from './routes/forecast.js';
import { healthRoutes } from './routes/health.js';
import { meRoutes } from './routes/me.js';
import { objectRoutes } from './routes/objects.js';
import { projectEngineV2BackfillRoutes } from './routes/project-engine-v2-backfill.js';
import { projectScheduleV2Routes } from './routes/project-schedule-v2.js';
import { resourceCapacityRoutes } from './routes/resource-capacity.js';
import { scheduleAnalysisRoutes } from './routes/schedule-analysis.js';
import { scheduleAnalysisV2Routes } from './routes/schedule-analysis-v2.js';
import { sessionRoutes } from './routes/session.js';
import { workCalendarV2Routes } from './routes/work-calendars-v2.js';

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

    request.log.error({ err: error }, 'Unhandled Bridata Project API error');
    const statusCode = error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
    void reply.code(statusCode).send({
      error: statusCode >= 500 ? 'internal_error' : 'request_error',
      message: statusCode >= 500 ? 'An unexpected error occurred.' : error.message,
      correlationId: request.id,
    });
  });

  // Inject hierarchy-specific policy after the normal authenticate/resolveActor
  // preHandlers of generic object writes, without forking the Object Engine CRUD.
  registerHierarchyWriteGuards(app);

  await app.register(healthRoutes);
  await app.register(sessionRoutes);
  await app.register(meRoutes);
  await app.register(bootstrapRoutes);
  await app.register(objectRoutes);
  await app.register(dependencyRoutes);
  await app.register(scheduleAnalysisRoutes);
  await app.register(projectScheduleV2Routes);
  await app.register(workCalendarV2Routes);
  await app.register(scheduleAnalysisV2Routes);
  await app.register(projectEngineV2BackfillRoutes);
  await app.register(forecastRoutes);
  await app.register(resourceCapacityRoutes);
  await app.register(baselineRoutes);

  return app;
}
