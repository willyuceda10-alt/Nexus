import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify';

import {
  Prisma,
} from '@prisma/client';

import { z } from 'zod';

import {
  authenticate,
  resolveActor,
} from '../auth.js';

import {
  canAccessWorkspace,
} from '../authorization.js';

import {
  buildHierarchyRiskAggregationV1g11,
  type HierarchyRiskProjectV1g11,
  type HierarchyRiskScopeV1g11,
} from '../domain/hierarchy-risk-aggregation-v1g11.js';

import {
  projectRiskHistoryPointFromAssessmentEventV1,
} from '../domain/project-risk-assessment-event-v1.js';

import {
  buildProjectRiskHistoryV1g10,
} from '../domain/project-risk-history-v1g10.js';

import {
  withTenant,
} from '../tenant-transaction.js';

const paramsSchema =
  z.object({
    scopeId:
      z.string().uuid(),
  });

type ScopeRequest =
  FastifyRequest<{
    Params: {
      scopeId: string;
    };
  }>;

type RiskEventRow = {
  id: string;
  aggregateId: string;
  payload: Prisma.JsonValue;
  createdAt: Date;
};

function jsonRecord(
  value:
    | Prisma.JsonValue
    | null,
):
Record<
  string,
  Prisma.JsonValue
> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return {};
  }

  return value as Record<
    string,
    Prisma.JsonValue
  >;
}

function parentId(
  metadata:
    | Prisma.JsonValue
    | null,

  key:
    | 'programId'
    | 'portfolioId',
): string | null {
  const value =
    jsonRecord(metadata)[key];

  return typeof value ===
    'string'
    ? value
    : null;
}

async function handleRiskOverview(
  request: ScopeRequest,
  reply: FastifyReply,
  scopeType:
    HierarchyRiskScopeV1g11,
) {
  const params =
    paramsSchema.safeParse(
      request.params,
    );

  if (!params.success) {
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
        const scope =
          await tx.nexusObject
            .findFirst({
              where: {
                id:
                  params.data.scopeId,

                tenantId:
                  actor.tenantId,

                objectTypeKey:
                  scopeType,

                deletedAt:
                  null,
              },

              select: {
                id: true,
                title: true,
                workspaceId: true,
              },
            });

        if (!scope) {
          return {
            kind: 'not_found' as const,
          };
        }

        const allowed =
          await canAccessWorkspace(
            tx,
            actor,
            scope.workspaceId,
          );

        if (!allowed) {
          return {
            kind: 'forbidden' as const,
          };
        }

        const workspaceProjects =
          await tx.nexusObject
            .findMany({
              where: {
                tenantId:
                  actor.tenantId,

                workspaceId:
                  scope.workspaceId,

                objectTypeKey:
                  'PROJECT',

                deletedAt:
                  null,
              },

              select: {
                id: true,
                title: true,
                metadata: true,
              },

              orderBy: {
                title:
                  'asc',
              },
            });

        const metadataKey =
          scopeType ===
          'PROGRAM'
            ? 'programId'
            : 'portfolioId';

        const projects =
          workspaceProjects.filter(
            (project) =>
              parentId(
                project.metadata,
                metadataKey,
              ) === scope.id,
          );

        if (
          projects.length === 0
        ) {
          return {
            kind: 'ok' as const,

            scope,

            invalidEventsSkipped:
              0,

            aggregation:
              buildHierarchyRiskAggregationV1g11(
                {
                  scopeType,
                  projects: [],
                },
              ),
          };
        }

        const projectIds =
          projects.map(
            (project) =>
              project.id,
          );

        const idsSql =
          Prisma.join(
            projectIds.map(
              (projectId) =>
                Prisma.sql`${projectId}::uuid`,
            ),
          );

        const events =
          await tx.$queryRaw<
            RiskEventRow[]
          >(Prisma.sql`
            SELECT
              id,
              aggregate_id AS "aggregateId",
              payload,
              created_at AS "createdAt"
            FROM (
              SELECT
                id,
                aggregate_id,
                payload,
                created_at,
                ROW_NUMBER() OVER (
                  PARTITION BY aggregate_id
                  ORDER BY created_at DESC, id DESC
                ) AS row_num
              FROM domain_events
              WHERE tenant_id =
                ${actor.tenantId}::uuid
                AND event_type =
                  'bridata.project.risk.assessed'
                AND aggregate_id IN (
                  ${idsSql}
                )
            ) ranked
            WHERE row_num <= 20
            ORDER BY
              aggregate_id ASC,
              created_at ASC,
              id ASC
          `);

        const pointsByProject =
          new Map<
            string,
            ReturnType<
              typeof projectRiskHistoryPointFromAssessmentEventV1
            >[]
          >();

        for (
          const project
          of projects
        ) {
          pointsByProject.set(
            project.id,
            [],
          );
        }

        let invalidEventsSkipped =
          0;

        for (
          const event
          of events
        ) {
          const point =
            projectRiskHistoryPointFromAssessmentEventV1(
              {
                id:
                  event.id,

                payload:
                  event.payload,

                createdAt:
                  event.createdAt,
              },

              event.aggregateId,
            );

          if (!point) {
            invalidEventsSkipped +=
              1;

            continue;
          }

          pointsByProject
            .get(
              event.aggregateId,
            )
            ?.push(point);
        }

        const projectRisks:
          HierarchyRiskProjectV1g11[] =
          projects.map(
            (project) => {
              const points =
                (
                  pointsByProject.get(
                    project.id,
                  ) ?? []
                ).filter(
                  (
                    point,
                  ): point is
                    NonNullable<
                      typeof point
                    > =>
                    point !== null,
                );

              const history =
                buildProjectRiskHistoryV1g10(
                  points,
                );

              const latest =
                history.timeline[0] ??
                null;

              return {
                projectId:
                  project.id,

                title:
                  project.title,

                currentRisk:
                  history.currentRisk,

                trend:
                  history.trend.current,

                requiresAttention:
                  latest
                    ?.requiresAttention ??
                  false,

                lastObservedAt:
                  history.lastObservedAt,

                hasRiskData:
                  history.currentRisk !==
                    null &&
                  history.currentRisk !==
                    'INSUFFICIENT_DATA',
              };
            },
          );

        return {
          kind: 'ok' as const,

          scope,

          invalidEventsSkipped,

          aggregation:
            buildHierarchyRiskAggregationV1g11(
              {
                scopeType,

                projects:
                  projectRisks,
              },
            ),
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
          'risk_scope_not_found',
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
          'hierarchy_risk_overview_denied',
      });
  }

  return reply.send({
    scope: {
      id:
        result.scope.id,

      title:
        result.scope.title,

      workspaceId:
        result.scope
          .workspaceId,
    },

    historyWindowPerProject:
      20,

    invalidEventsSkipped:
      result.invalidEventsSkipped,

    ...result.aggregation,
  });
}

export async function
hierarchyRiskOverviewV1g11Routes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    '/api/v1/programs/:scopeId/risk-overview-v1g11',

    {
      preHandler: [
        authenticate,
        resolveActor,
      ],
    },

    async (
      request,
      reply,
    ) =>
      handleRiskOverview(
        request as ScopeRequest,
        reply,
        'PROGRAM',
      ),
  );

  app.get(
    '/api/v1/portfolios/:scopeId/risk-overview-v1g11',

    {
      preHandler: [
        authenticate,
        resolveActor,
      ],
    },

    async (
      request,
      reply,
    ) =>
      handleRiskOverview(
        request as ScopeRequest,
        reply,
        'PORTFOLIO',
      ),
  );
}
