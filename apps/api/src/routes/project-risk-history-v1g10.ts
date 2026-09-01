import type {
  FastifyInstance,
} from 'fastify';

import { z } from 'zod';

import {
  authenticate,
  resolveActor,
} from '../auth.js';

import {
  canAccessWorkspace,
} from '../authorization.js';

import {
  projectRiskHistoryPointFromAssessmentEventV1,
} from '../domain/project-risk-assessment-event-v1.js';

import {
  buildProjectRiskHistoryV1g10,
  type ProjectRiskHistoryPointV1g10,
} from '../domain/project-risk-history-v1g10.js';

import {
  withTenant,
} from '../tenant-transaction.js';

import {
  validProject,
} from './cost-engine-v2-utils.js';

const paramsSchema = z.object({
  projectId:
    z.string().uuid(),
});

const querySchema = z.object({
  limit:
    z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50),
});

export async function
projectRiskHistoryV1g10Routes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    '/api/v1/projects/:projectId/risk-history-v1g10',

    {
      preHandler: [
        authenticate,
        resolveActor,
      ],
    },

    async (
      request,
      reply,
    ) => {
      const params =
        paramsSchema.safeParse(
          request.params,
        );

      const query =
        querySchema.safeParse(
          request.query,
        );

      if (
        !params.success ||
        !query.success
      ) {
        return reply
          .code(400)
          .send({
            error:
              'validation_error',
          });
      }

      const actor =
        request.actor!;

      const result =
        await withTenant(
          actor.tenantId,

          async (tx) => {
            const project =
              await validProject(
                tx,
                actor.tenantId,
                params.data.projectId,
              );

            if (!project) {
              return {
                kind: 'not_found' as const,
              };
            }

            const allowed =
              await canAccessWorkspace(
                tx,
                actor,
                project.workspaceId,
              );

            if (!allowed) {
              return {
                kind: 'forbidden' as const,
              };
            }

            const events =
              await tx.domainEvent
                .findMany({
                  where: {
                    tenantId:
                      actor.tenantId,

                    aggregateId:
                      project.id,

                    eventType:
                      'bridata.project.risk.assessed',
                  },

                  orderBy: {
                    createdAt:
                      'desc',
                  },

                  take:
                    query.data.limit,

                  select: {
                    id: true,
                    payload: true,
                    createdAt: true,
                  },
                });

            const points:
              ProjectRiskHistoryPointV1g10[] =
              [];

            let invalidEventsSkipped =
              0;

            for (
              const event
              of events
            ) {
              const point =
                projectRiskHistoryPointFromAssessmentEventV1(
                  event,
                  project.id,
                );

              if (!point) {
                invalidEventsSkipped +=
                  1;

                continue;
              }

              points.push(point);
            }

            return {
              kind: 'ok' as const,

              project,

              history:
                buildProjectRiskHistoryV1g10(
                  points,
                ),

              invalidEventsSkipped,
            };
          },
        );

      if (
        result.kind ===
        'not_found'
      ) {
        return reply
          .code(404)
          .send({
            error:
              'project_not_found',
          });
      }

      if (
        result.kind ===
        'forbidden'
      ) {
        return reply
          .code(403)
          .send({
            error:
              'project_risk_history_denied',
          });
      }

      return reply.send({
        project: {
          id:
            result.project.id,

          title:
            result.project.title,

          workspaceId:
            result.project
              .workspaceId,
        },

        invalidEventsSkipped:
          result.invalidEventsSkipped,

        ...result.history,
      });
    },
  );
}
