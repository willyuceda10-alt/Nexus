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
            tx.objectDefinition.findFirst({
              where: {
                tenantId,
                key: 'PORTFOLIO',
              },
              select: {
                id: true,
              },
            }),

            tx.objectDefinition.findFirst({
              where: {
                tenantId,
                key: 'PROGRAM',
              },
              select: {
                id: true,
              },
            }),

            tx.objectDefinition.findFirst({
              where: {
                tenantId,
                key: 'PROJECT',
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

        await tx.nexusObject.create({
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
              `Portafolio financiero G12 ${suffix}`,

            status:
              'ACTIVE',

            priority:
              'HIGH',

            progress: 0,

            ownerId:
              userId,

            metadata: {
              source:
                'G12_SMOKE',
            },
          },
        });

        await tx.nexusObject.create({
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
              `Programa financiero G12 ${suffix}`,

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
                'G12_SMOKE',
            },
          },
        });

        const createProject =
          async (
            id: string,
            title: string,
            includeProgram: boolean,
          ) => {
            await tx.nexusObject.create({
              data: {
                id,

                tenantId,
                workspaceId,

                objectDefinitionId:
                  projectDefinition.id,

                objectTypeKey:
                  'PROJECT',

                title,

                status:
                  'ACTIVE',

                priority:
                  'HIGH',

                progress: 0,

                ownerId:
                  userId,

                metadata: {
                  portfolioId,

                  ...(includeProgram
                    ? {
                        programId,
                      }
                    : {}),

                  source:
                    'G12_SMOKE',
                },
              },
            });
          };

        await createProject(
          projectAId,
          `Proyecto crítico G12 ${suffix}`,
          true,
        );

        await createProject(
          projectBId,
          `Proyecto alto G12 ${suffix}`,
          true,
        );

        await createProject(
          projectCId,
          `Proyecto estable G12 ${suffix}`,
          false,
        );

        const createAssessment =
          async (
            projectId: string,
            riskLevel:
              | 'ON_TRACK'
              | 'HIGH'
              | 'CRITICAL',
            controlBudget: number,
            estimateAtCompletion: number,
          ) => {
            await tx.domainEvent.create({
              data: {
                tenantId,

                aggregateId:
                  projectId,

                eventType:
                  'bridata.project.risk.assessed',

                idempotencyKey:
                  `g12:${projectId}:${suffix}`,

                payload: {
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

                  controlBudget,

                  estimateAtCompletion,

                  varianceAtCompletion:
                    controlBudget -
                    estimateAtCompletion,

                  scheduleHealth:
                    'ON_TRACK',

                  plannedFinish:
                    null,

                  forecastFinish:
                    null,

                  forecastVariancePercent:
                    controlBudget > 0
                      ? (
                          (
                            estimateAtCompletion -
                            controlBudget
                          ) /
                          controlBudget
                        ) * 100
                      : null,

                  forecastVarianceDays:
                    0,

                  requiresAttention:
                    riskLevel ===
                      'HIGH' ||
                    riskLevel ===
                      'CRITICAL',

                  fingerprint:
                    `g12-${projectId}-${suffix}`,
                },
              },
            });
          };

        await createAssessment(
          projectAId,
          'CRITICAL',
          1000,
          1200,
        );

        await createAssessment(
          projectBId,
          'HIGH',
          500,
          550,
        );

        await createAssessment(
          projectCId,
          'ON_TRACK',
          500,
          480,
        );
      },
    );


    const programResponse =
      await app.inject({
        method: 'GET',

        url:
          `/api/v1/programs/${programId}/financial-risk-v1g12`,
      });

    assert(
      programResponse.statusCode ===
        200,

      `G12 program failed: ${programResponse.statusCode} ${programResponse.body}`,
    );

    const program =
      programResponse.json();

    assert(
      program.version ===
        'v1g12',

      'Unexpected G12 program version',
    );

    assert(
      program.totalProjects === 2,
      `Expected 2 program projects, got ${program.totalProjects}`,
    );

    assert(
      program.financialCoveragePercent ===
        100,

      `Expected program financial coverage=100, got ${program.financialCoveragePercent}`,
    );

    const programUsd =
      program.currencyGroups.find(
        (group: {
          currency: string;
        }) =>
          group.currency ===
          'USD',
      ) ??
      program.currencyGroups[0];

    assert(
      programUsd,
      'Program currency group missing',
    );

    assert(
      programUsd.totalControlBudget ===
        1500,

      `Expected program budget=1500, got ${programUsd.totalControlBudget}`,
    );

    assert(
      programUsd.totalEstimateAtCompletion ===
        1750,

      `Expected program EAC=1750, got ${programUsd.totalEstimateAtCompletion}`,
    );

    assert(
      programUsd.totalProjectedOverrun ===
        250,

      `Expected program overrun=250, got ${programUsd.totalProjectedOverrun}`,
    );

    assert(
      programUsd.riskExposedBudgetPercent ===
        100,

      `Expected program exposure=100%, got ${programUsd.riskExposedBudgetPercent}`,
    );


    const portfolioResponse =
      await app.inject({
        method: 'GET',

        url:
          `/api/v1/portfolios/${portfolioId}/financial-risk-v1g12`,
      });

    assert(
      portfolioResponse.statusCode ===
        200,

      `G12 portfolio failed: ${portfolioResponse.statusCode} ${portfolioResponse.body}`,
    );

    const portfolio =
      portfolioResponse.json();

    assert(
      portfolio.totalProjects === 3,
      `Expected 3 portfolio projects, got ${portfolio.totalProjects}`,
    );

    const portfolioUsd =
      portfolio.currencyGroups.find(
        (group: {
          currency: string;
        }) =>
          group.currency ===
          'USD',
      ) ??
      portfolio.currencyGroups[0];

    assert(
      portfolioUsd,
      'Portfolio currency group missing',
    );

    assert(
      portfolioUsd.totalControlBudget ===
        2000,

      `Expected portfolio budget=2000, got ${portfolioUsd.totalControlBudget}`,
    );

    assert(
      portfolioUsd.totalEstimateAtCompletion ===
        2230,

      `Expected portfolio EAC=2230, got ${portfolioUsd.totalEstimateAtCompletion}`,
    );

    assert(
      portfolioUsd.totalProjectedOverrun ===
        250,

      `Expected portfolio overrun=250, got ${portfolioUsd.totalProjectedOverrun}`,
    );

    assert(
      portfolioUsd.riskExposedControlBudget ===
        1500,

      `Expected exposed budget=1500, got ${portfolioUsd.riskExposedControlBudget}`,
    );

    assert(
      portfolioUsd.riskExposedBudgetPercent ===
        75,

      `Expected exposed budget=75%, got ${portfolioUsd.riskExposedBudgetPercent}`,
    );

    assert(
      portfolio.legacyProjectsRecomputed ===
        0,

      `Expected zero legacy recomputes, got ${portfolio.legacyProjectsRecomputed}`,
    );


    console.log(
      JSON.stringify({
        hierarchyFinancialRiskV1g12:
          'PASS',

        programControlBudget:
          programUsd
            .totalControlBudget,

        programEac:
          programUsd
            .totalEstimateAtCompletion,

        programProjectedOverrun:
          programUsd
            .totalProjectedOverrun,

        portfolioControlBudget:
          portfolioUsd
            .totalControlBudget,

        portfolioEac:
          portfolioUsd
            .totalEstimateAtCompletion,

        portfolioProjectedOverrun:
          portfolioUsd
            .totalProjectedOverrun,

        portfolioRiskExposedBudget:
          portfolioUsd
            .riskExposedControlBudget,

        portfolioRiskExposedPercent:
          portfolioUsd
            .riskExposedBudgetPercent,

        financialCoveragePercent:
          portfolio
            .financialCoveragePercent,

        legacyProjectsRecomputed:
          portfolio
            .legacyProjectsRecomputed,
      }),
    );
  } finally {
    await withTenant(
      tenantId,

      async (tx) => {
        await tx.domainEvent.deleteMany({
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

        await tx.nexusObject.deleteMany({
          where: {
            tenantId,

            id: {
              in:
                projectIds,
            },
          },
        });

        await tx.nexusObject.deleteMany({
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
