import {
  randomUUID,
} from 'node:crypto';

import {
  buildApp,
} from '../src/app.js';

import {
  withTenant,
} from '../src/tenant-transaction.js';

const tenantId =
  process.env.DEV_TENANT_ID ??
  '00000000-0000-4000-8000-000000000002';

const userId =
  process.env.DEV_USER_ID ??
  '00000000-0000-4000-8000-000000000001';

const workspaceId =
  '00000000-0000-4000-8000-000000000003';

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

type RiskLevel =
  | 'ON_TRACK'
  | 'WATCH'
  | 'HIGH'
  | 'CRITICAL';

async function main() {
  const suffix =
    Date.now()
      .toString()
      .slice(-8);

  const portfolioId =
    randomUUID();

  const programId =
    randomUUID();

  const projectAId =
    randomUUID();

  const projectBId =
    randomUUID();

  const projectCId =
    randomUUID();

  const projectIds = [
    projectAId,
    projectBId,
    projectCId,
  ];

  const app =
    await buildApp();

  await app.ready();

  try {
    await withTenant(
      tenantId,

      async (tx) => {
        const [
          portfolioDefinition,
          programDefinition,
          projectDefinition,
        ] =
          await Promise.all([
            tx.objectDefinition
              .findFirst({
                where: {
                  tenantId,
                  key:
                    'PORTFOLIO',
                },

                select: {
                  id: true,
                },
              }),

            tx.objectDefinition
              .findFirst({
                where: {
                  tenantId,
                  key:
                    'PROGRAM',
                },

                select: {
                  id: true,
                },
              }),

            tx.objectDefinition
              .findFirst({
                where: {
                  tenantId,
                  key:
                    'PROJECT',
                },

                select: {
                  id: true,
                },
              }),
          ]);

        assert(
          portfolioDefinition,
          'PORTFOLIO definition missing',
        );

        assert(
          programDefinition,
          'PROGRAM definition missing',
        );

        assert(
          projectDefinition,
          'PROJECT definition missing',
        );

        await tx.nexusObject
          .create({
            data: {
              id:
                portfolioId,

              tenantId,
              workspaceId,

              objectDefinitionId:
                portfolioDefinition.id,

              objectTypeKey:
                'PORTFOLIO',

              title:
                `Portafolio G11 ${suffix}`,

              status:
                'ACTIVE',

              priority:
                'HIGH',

              progress: 0,

              ownerId:
                userId,

              metadata: {
                source:
                  'G11_SMOKE',
              },
            },
          });

        await tx.nexusObject
          .create({
            data: {
              id:
                programId,

              tenantId,
              workspaceId,

              objectDefinitionId:
                programDefinition.id,

              objectTypeKey:
                'PROGRAM',

              title:
                `Programa G11 ${suffix}`,

              status:
                'ACTIVE',

              priority:
                'HIGH',

              progress: 0,

              ownerId:
                userId,

              metadata: {
                portfolioId,

                source:
                  'G11_SMOKE',
              },
            },
          });

        await tx.nexusObject
          .create({
            data: {
              id:
                projectAId,

              tenantId,
              workspaceId,

              objectDefinitionId:
                projectDefinition.id,

              objectTypeKey:
                'PROJECT',

              title:
                `Proyecto crítico G11 ${suffix}`,

              status:
                'ACTIVE',

              priority:
                'CRITICAL',

              progress: 0,

              ownerId:
                userId,

              metadata: {
                portfolioId,
                programId,

                source:
                  'G11_SMOKE',
              },
            },
          });

        await tx.nexusObject
          .create({
            data: {
              id:
                projectBId,

              tenantId,
              workspaceId,

              objectDefinitionId:
                projectDefinition.id,

              objectTypeKey:
                'PROJECT',

              title:
                `Proyecto alto G11 ${suffix}`,

              status:
                'ACTIVE',

              priority:
                'HIGH',

              progress: 0,

              ownerId:
                userId,

              metadata: {
                portfolioId,
                programId,

                source:
                  'G11_SMOKE',
              },
            },
          });

        await tx.nexusObject
          .create({
            data: {
              id:
                projectCId,

              tenantId,
              workspaceId,

              objectDefinitionId:
                projectDefinition.id,

              objectTypeKey:
                'PROJECT',

              title:
                `Proyecto estable G11 ${suffix}`,

              status:
                'ACTIVE',

              priority:
                'MEDIUM',

              progress: 0,

              ownerId:
                userId,

              metadata: {
                portfolioId,

                source:
                  'G11_SMOKE',
              },
            },
          });

        const now =
          Date.now();

        const riskPayload = (
          projectId: string,
          riskLevel: RiskLevel,
          fingerprint: string,
        ) => ({
          version:
            'v1g8',

          projectId,
          workspaceId,

          riskLevel,

          drivers:
            riskLevel ===
            'ON_TRACK'
              ? []
              : [
                  'COST_OVERRUN',
                ],

          financialHealth:
            riskLevel,

          scheduleHealth:
            'ON_TRACK',

          forecastVariancePercent:
            riskLevel ===
            'ON_TRACK'
              ? 0
              : 10,

          forecastVarianceDays:
            0,

          requiresAttention:
            riskLevel !==
            'ON_TRACK',

          fingerprint,
        });

        const createRisk =
          async (
            projectId: string,
            riskLevel: RiskLevel,
            fingerprint: string,
            hoursAgo: number,
          ) => {
            await tx.domainEvent
              .create({
                data: {
                  tenantId,

                  aggregateId:
                    projectId,

                  eventType:
                    'bridata.project.risk.assessed',

                  idempotencyKey:
                    `g11:${projectId}:${fingerprint}`,

                  createdAt:
                    new Date(
                      now -
                      (
                        hoursAgo *
                        60 *
                        60 *
                        1000
                      ),
                    ),

                  payload:
                    riskPayload(
                      projectId,
                      riskLevel,
                      fingerprint,
                    ),
                },
              });
          };

        await createRisk(
          projectAId,
          'WATCH',
          `a-watch-${suffix}`,
          2,
        );

        await createRisk(
          projectAId,
          'CRITICAL',
          `a-critical-${suffix}`,
          1,
        );

        await createRisk(
          projectBId,
          'HIGH',
          `b-high-1-${suffix}`,
          2,
        );

        await createRisk(
          projectBId,
          'HIGH',
          `b-high-2-${suffix}`,
          1,
        );

        await createRisk(
          projectCId,
          'ON_TRACK',
          `c-track-${suffix}`,
          1,
        );
      },
    );


    const programResponse =
      await app.inject({
        method:
          'GET',

        url:
          `/api/v1/programs/${programId}/risk-overview-v1g11`,
      });

    assert(
      programResponse.statusCode ===
        200,

      `G11 program failed: ${programResponse.statusCode} ${programResponse.body}`,
    );

    const program =
      programResponse.json();

    assert(
      program.version ===
        'v1g11',

      'Unexpected G11 program version',
    );

    assert(
      program.scopeType ===
        'PROGRAM',

      'G11 program scope type invalid',
    );

    assert(
      program.totalProjects ===
        2,

      `Expected 2 program projects, got ${program.totalProjects}`,
    );

    assert(
      program.aggregateRisk ===
        'CRITICAL',

      `Expected program CRITICAL, got ${program.aggregateRisk}`,
    );

    assert(
      program.aggregateTrend ===
        'WORSENING',

      `Expected program WORSENING, got ${program.aggregateTrend}`,
    );

    assert(
      program.riskCounts
        .CRITICAL === 1,

      'Expected one program CRITICAL project',
    );

    assert(
      program.riskCounts
        .HIGH === 1,

      'Expected one program HIGH project',
    );

    assert(
      program.highCriticalPercent ===
        100,

      `Expected program highCriticalPercent=100, got ${program.highCriticalPercent}`,
    );


    const portfolioResponse =
      await app.inject({
        method:
          'GET',

        url:
          `/api/v1/portfolios/${portfolioId}/risk-overview-v1g11`,
      });

    assert(
      portfolioResponse.statusCode ===
        200,

      `G11 portfolio failed: ${portfolioResponse.statusCode} ${portfolioResponse.body}`,
    );

    const portfolio =
      portfolioResponse.json();

    assert(
      portfolio.version ===
        'v1g11',

      'Unexpected G11 portfolio version',
    );

    assert(
      portfolio.scopeType ===
        'PORTFOLIO',

      'G11 portfolio scope type invalid',
    );

    assert(
      portfolio.totalProjects ===
        3,

      `Expected 3 portfolio projects, got ${portfolio.totalProjects}`,
    );

    assert(
      portfolio.aggregateRisk ===
        'CRITICAL',

      `Expected portfolio CRITICAL, got ${portfolio.aggregateRisk}`,
    );

    assert(
      portfolio.aggregateTrend ===
        'WORSENING',

      `Expected portfolio WORSENING, got ${portfolio.aggregateTrend}`,
    );

    assert(
      portfolio.riskCounts
        .CRITICAL === 1,

      'Expected one portfolio CRITICAL project',
    );

    assert(
      portfolio.riskCounts
        .HIGH === 1,

      'Expected one portfolio HIGH project',
    );

    assert(
      portfolio.riskCounts
        .ON_TRACK === 1,

      'Expected one portfolio ON_TRACK project',
    );

    assert(
      portfolio.highCriticalPercent ===
        66.67,

      `Expected portfolio highCriticalPercent=66.67, got ${portfolio.highCriticalPercent}`,
    );

    assert(
      portfolio.coveragePercent ===
        100,

      `Expected portfolio coverage=100, got ${portfolio.coveragePercent}`,
    );


    console.log(
      JSON.stringify({
        hierarchyRiskV1g11:
          'PASS',

        programRisk:
          program.aggregateRisk,

        programTrend:
          program.aggregateTrend,

        programProjects:
          program.totalProjects,

        portfolioRisk:
          portfolio.aggregateRisk,

        portfolioTrend:
          portfolio.aggregateTrend,

        portfolioProjects:
          portfolio.totalProjects,

        highCriticalPortfolioPercent:
          portfolio
            .highCriticalPercent,

        riskCoveragePercent:
          portfolio.coveragePercent,

        hierarchySource:
          'PROJECT_METADATA',

        canonicalHierarchy:
          'PORTFOLIO_PROGRAM_PROJECT',
      }),
    );
  } finally {
    await withTenant(
      tenantId,

      async (tx) => {
        await tx.domainEvent
          .deleteMany({
            where: {
              tenantId,

              aggregateId: {
                in:
                  projectIds,
              },

              eventType:
                'bridata.project.risk.assessed',
            },
          });

        await tx.nexusObject
          .deleteMany({
            where: {
              tenantId,

              id: {
                in:
                  projectIds,
              },
            },
          });

        await tx.nexusObject
          .deleteMany({
            where: {
              tenantId,

              id: {
                in: [
                  programId,
                  portfolioId,
                ],
              },
            },
          });
      },
    );

    await app.close();
  }
}

main().catch(
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
