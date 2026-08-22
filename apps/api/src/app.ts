import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { config } from './config.js';
import { registerRequestContext } from './auth.js';
import { baselineRoutes } from './routes/baselines.js';
import { bootstrapRoutes } from './routes/bootstrap.js';
import { dependencyRoutes } from './routes/dependencies.js';
import { forecastRoutes } from './routes/forecast.js';
import { healthRoutes } from './routes/health.js';
import { meRoutes } from './routes/me.js';
import { objectRoutes } from './routes/objects.js';
import { scheduleAnalysisRoutes } from './routes/schedule-analysis.js';
import { sessionRoutes } from './routes/session.js';

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
    request.log.error({ err: error }, 'Unhandled Bridata Project API error');
    const statusCode = error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
    void reply.code(statusCode).send({
      error: statusCode >= 500 ? 'internal_error' : 'request_error',
      message: statusCode >= 500 ? 'An unexpected error occurred.' : error.message,
      correlationId: request.id,
    });
  });

  await app.register(healthRoutes);
  await app.register(sessionRoutes);
  await app.register(meRoutes);
  await app.register(bootstrapRoutes);
  await app.register(objectRoutes);
  await app.register(dependencyRoutes);
  await app.register(scheduleAnalysisRoutes);
  await app.register(forecastRoutes);
  await app.register(baselineRoutes);

  return app;
}
