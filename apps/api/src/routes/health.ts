import type {
  FastifyInstance,
} from 'fastify';

import {
  config,
} from '../config.js';

import {
  prisma,
} from '../db.js';

import {
  buildProjectRiskMonitorWatchdogV1g19,
} from '../project-risk-monitor-watchdog-v1g19.js';

import {
  readProjectRiskMonitorRuntimeV1g18,
} from '../project-risk-monitor-reliability-v1g18.js';

export async function
healthRoutes(
  app:
    FastifyInstance,
): Promise<void> {
  app.get(
    '/health/live',
    async () => ({
      status:
        'ok',

      service:
        'nexus-api',

      timestamp:
        new Date()
          .toISOString(),
    }),
  );

  app.get(
    '/health/ready',
    async (
      _request,
      reply,
    ) => {
      try {
        await prisma
          .$queryRaw`
            SELECT 1
          `;

        return {
          status:
            'ready',

          database:
            'ok',

          timestamp:
            new Date()
              .toISOString(),
        };
      } catch (error) {
        app.log.error(
          {
            err:
              error,
          },
          'Database readiness check failed',
        );

        return reply
          .code(503)
          .send({
            status:
              'not_ready',

            database:
              'unavailable',

            timestamp:
              new Date()
                .toISOString(),
          });
      }
    },
  );

  app.get(
    '/health/risk-monitor',
    async (
      _request,
      reply,
    ) => {
      try {
        const runtime =
          await readProjectRiskMonitorRuntimeV1g18();

        const watchdog =
          buildProjectRiskMonitorWatchdogV1g19({
            expected:
              config
                .PROJECT_RISK_MONITOR_EXPECTED,

            staleAfterMs:
              config
                .PROJECT_RISK_MONITOR_STALE_MINUTES *
              60 *
              1000,

            runtime,
          });

        const payload = {
          status:
            watchdog.healthy
              ? 'healthy'
              : 'unhealthy',

          component:
            'project-risk-monitor',

          version:
            watchdog.version,

          expected:
            watchdog.expected,

          state:
            watchdog.state,

          reason:
            watchdog.reason,

          running:
            watchdog.running,

          lastStatus:
            watchdog.lastStatus,

          lastStartedAt:
            watchdog.lastStartedAt
              ?.toISOString() ??
            null,

          lastCompletedAt:
            watchdog.lastCompletedAt
              ?.toISOString() ??
            null,

          heartbeatAt:
            watchdog.heartbeatAt
              ?.toISOString() ??
            null,

          expiresAt:
            watchdog.expiresAt
              ?.toISOString() ??
            null,

          lastDurationMs:
            watchdog.lastDurationMs,

          lastCompletedAgeSeconds:
            watchdog
              .lastCompletedAgeSeconds,

          staleAfterSeconds:
            watchdog
              .staleAfterSeconds,

          timestamp:
            new Date()
              .toISOString(),
        };

        if (!watchdog.healthy) {
          return reply
            .header(
              'Retry-After',
              '60',
            )
            .code(503)
            .send(
              payload,
            );
        }

        return payload;
      } catch (error) {
        app.log.error(
          {
            err:
              error,
          },
          'Project risk monitor watchdog failed',
        );

        return reply
          .header(
            'Retry-After',
            '60',
          )
          .code(503)
          .send({
            status:
              'unhealthy',

            component:
              'project-risk-monitor',

            version:
              'v1g19',

            state:
              'FAILED',

            reason:
              'WATCHDOG_QUERY_FAILED',

            timestamp:
              new Date()
                .toISOString(),
          });
      }
    },
  );
}
