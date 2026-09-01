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
  buildFinancialRiskExposureV1g12,
  type FinancialRiskProjectV1g12,
} from '../domain/hierarchy-financial-risk-v1g12.js';

import {
  projectRiskAssessmentPayloadSchemaV1,
} from '../domain/project-risk-assessment-event-v1.js';

import {
  calculateCurrentRisk,
} from '../project-risk-evaluation-service.js';

import {
  withTenant,
} from '../tenant-transaction.js';

import {
  tenantCurrency,
} from './cost-engine-v2-utils.js';

const paramsSchema =
  z.object({
    scopeId:
      z.string().uuid(),
  });

type ScopeType =
  | 'PROGRAM'
  | 'PORTFOLIO';

type ScopeRequest =
  FastifyRequest<{
    Params: {
      scopeId: string;
    };
  }>;

type LatestRiskRow = {
  id: string;
  aggregateId: string;
  payload: Prisma.JsonValue;
  createdAt: Date;
};

type CurrencyRow = {
  projectId: string;
  currency: string;
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

function hierarchyParentId(
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

function percentage(
  numerator: number,
  denominator: number,
): number {
  if (denominator <= 0) {
    return 0;
  }

  return Math.round(
    (
      numerator /
      denominator
    ) * 10000,
  ) / 100;
}

async function handleFinancialExposure(
  request: ScopeRequest,
  reply: FastifyReply,
  scopeType: ScopeType,
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
                workspaceId: true,
                metadata: true,
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
              hierarchyParentId(
                project.metadata,
                metadataKey,
              ) === scope.id,
          );

        if (
          projects.length === 0
        ) {
          return {
            kind:
              'ok' as const,

            scope,

            totalProjects:
              0,

            financialProjects:
              0,

            legacyProjectsRecomputed:
              0,

            invalidEventsSkipped:
              0,

            currencyGroups:
              [],
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

        const [
          latestEvents,
          profileCurrencies,
          tenant,
        ] =
          await Promise.all([
            tx.$queryRaw<
              LatestRiskRow[]
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
                    ORDER BY
                      created_at DESC,
                      id DESC
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
              WHERE row_num = 1
            `),

            tx.$queryRaw<
              CurrencyRow[]
            >(Prisma.sql`
              SELECT
                project_object_id
                  AS "projectId",
                currency
              FROM project_cost_profiles
              WHERE tenant_id =
                ${actor.tenantId}::uuid
                AND project_object_id IN (
                  ${idsSql}
                )
            `),

            tx.tenant.findUnique({
              where: {
                id:
                  actor.tenantId,
              },

              select: {
                metadata: true,
              },
            }),
          ]);

        const defaultCurrency =
          tenantCurrency(
            tenant?.metadata ??
            null,
          );

        const currencyByProject =
          new Map(
            profileCurrencies.map(
              (row) => [
                row.projectId,
                row.currency,
              ],
            ),
          );

        const eventByProject =
          new Map(
            latestEvents.map(
              (event) => [
                event.aggregateId,
                event,
              ],
            ),
          );

        const financialProjects:
          FinancialRiskProjectV1g12[] =
          [];

        let legacyProjectsRecomputed =
          0;

        let invalidEventsSkipped =
          0;

        for (
          const project
          of projects
        ) {
          const event =
            eventByProject.get(
              project.id,
            );

          const parsed =
            event
              ? projectRiskAssessmentPayloadSchemaV1
                  .safeParse(
                    event.payload,
                  )
              : null;

          const hasSnapshotFinancials =
            parsed?.success ===
              true &&
            parsed.data.projectId ===
              project.id &&
            typeof parsed.data
              .controlBudget ===
              'number' &&
            typeof parsed.data
              .estimateAtCompletion ===
              'number' &&
            typeof parsed.data
              .varianceAtCompletion ===
              'number';

          if (
            event &&
            parsed &&
            !parsed.success
          ) {
            invalidEventsSkipped +=
              1;
          }

          if (hasSnapshotFinancials) {
            financialProjects.push({
              projectId:
                project.id,

              title:
                project.title,

              riskLevel:
                parsed.data
                  .riskLevel,

              currency:
                currencyByProject.get(
                  project.id,
                ) ??
                defaultCurrency,

              controlBudget:
                parsed.data
                  .controlBudget!,

              estimateAtCompletion:
                parsed.data
                  .estimateAtCompletion!,

              varianceAtCompletion:
                parsed.data
                  .varianceAtCompletion!,

              financialDataSource:
                'RISK_SNAPSHOT',
            });

            continue;
          }

          const current =
            await calculateCurrentRisk(
              tx,
              actor.tenantId,
              project,
            );

          legacyProjectsRecomputed +=
            1;

          financialProjects.push({
            projectId:
              project.id,

            title:
              project.title,

            riskLevel:
              current.risk
                .riskLevel,

            currency:
              current.currency,

            controlBudget:
              current.summary
                .controlBudget,

            estimateAtCompletion:
              current.summary
                .estimateAtCompletion,

            varianceAtCompletion:
              current.summary
                .varianceAtCompletion,

            financialDataSource:
              'LEGACY_RECOMPUTE',
          });
        }

        const grouped =
          new Map<
            string,
            FinancialRiskProjectV1g12[]
          >();

        for (
          const project
          of financialProjects
        ) {
          const group =
            grouped.get(
              project.currency,
            ) ?? [];

          group.push(project);

          grouped.set(
            project.currency,
            group,
          );
        }

        const currencyGroups =
          [...grouped.entries()]
            .sort(
              ([a], [b]) =>
                a.localeCompare(b),
            )
            .map(
              (
                [
                  currency,
                  items,
                ],
              ) =>
                buildFinancialRiskExposureV1g12(
                  {
                    currency,
                    projects:
                      items,
                  },
                ),
            );

        return {
          kind:
            'ok' as const,

          scope,

          totalProjects:
            projects.length,

          financialProjects:
            financialProjects.length,

          legacyProjectsRecomputed,

          invalidEventsSkipped,

          currencyGroups,
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
          'financial_risk_scope_not_found',
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
          'hierarchy_financial_risk_denied',
      });
  }

  return reply.send({
    version:
      'v1g12',

    scopeType,

    scope: {
      id:
        result.scope.id,

      title:
        result.scope.title,

      workspaceId:
        result.scope
          .workspaceId,
    },

    totalProjects:
      result.totalProjects,

    financialProjects:
      result.financialProjects,

    financialCoveragePercent:
      percentage(
        result.financialProjects,
        result.totalProjects,
      ),

    legacyProjectsRecomputed:
      result.legacyProjectsRecomputed,

    invalidEventsSkipped:
      result.invalidEventsSkipped,

    currencyGroups:
      result.currencyGroups,
  });
}

export async function
hierarchyFinancialRiskV1g12Routes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    '/api/v1/programs/:scopeId/financial-risk-v1g12',

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
      handleFinancialExposure(
        request as ScopeRequest,
        reply,
        'PROGRAM',
      ),
  );

  app.get(
    '/api/v1/portfolios/:scopeId/financial-risk-v1g12',

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
      handleFinancialExposure(
        request as ScopeRequest,
        reply,
        'PORTFOLIO',
      ),
  );
}
