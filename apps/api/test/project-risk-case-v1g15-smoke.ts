import {
  randomUUID,
} from 'node:crypto';

import {
  buildApp,
} from '../src/app.js';

import {
  syncProjectRiskCaseV1g15,
} from '../src/domain/project-risk-case-v1g15.js';

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
  const projectId =
    randomUUID();

  const mitigationId =
    randomUUID();

  let riskId:
    string |
    null = null;

  const app =
    await buildApp();

  await app.ready();

  try {
    await withTenant(
      tenantId,

      async (tx) => {
        const [
          projectDefinition,
          taskDefinition,
        ] =
          await Promise.all([
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

            tx.objectDefinition
              .findFirst({
                where: {
                  tenantId,
                  key:
                    'TASK',
                },

                select: {
                  id: true,
                },
              }),
          ]);

        assert(
          projectDefinition,
          'PROJECT definition missing',
        );

        assert(
          taskDefinition,
          'TASK definition missing',
        );

        await tx.nexusObject.create({
          data: {
            id:
              projectId,

            tenantId,
            workspaceId,

            objectDefinitionId:
              projectDefinition.id,

            objectTypeKey:
              'PROJECT',

            title:
              'G15 Risk Case Smoke Project',

            status:
              'IN_PROGRESS',

            priority:
              'HIGH',

            progress:
              40,

            ownerId:
              userId,

            assigneeId:
              userId,

            metadata: {
              source:
                'G15_SMOKE',
            },
          },
        });

        await tx.nexusObject.create({
          data: {
            id:
              mitigationId,

            tenantId,
            workspaceId,

            objectDefinitionId:
              taskDefinition.id,

            objectTypeKey:
              'TASK',

            title:
              'G15 Mitigation Action',

            status:
              'IN_PROGRESS',

            priority:
              'HIGH',

            progress:
              10,

            ownerId:
              userId,

            assigneeId:
              userId,

            metadata: {
              projectId,

              source:
                'G15_SMOKE',
            },
          },
        });

        const sync =
          await syncProjectRiskCaseV1g15(
            tx,
            {
              tenantId,

              project: {
                id:
                  projectId,

                title:
                  'G15 Risk Case Smoke Project',

                workspaceId,

                ownerId:
                  userId,
              },

              snapshot: {
                riskLevel:
                  'CRITICAL',

                drivers: [
                  'COST_OVERRUN',
                  'SCHEDULE_DELAY',
                ],

                fingerprint:
                  'g15-critical-1',

                financialHealth:
                  'HIGH',

                scheduleHealth:
                  'CRITICAL',
              },
            },
          );

        assert(
          sync.action ===
            'CREATED',

          `Expected CREATED, got ${sync.action}`,
        );

        assert(
          sync.riskCase,
          'G15 risk case missing',
        );

        riskId =
          sync.riskCase.id;
      },
    );

    assert(
      riskId,
      'G15 risk id missing',
    );


    const getResponse =
      await app.inject({
        method:
          'GET',

        url:
          `/api/v1/projects/${projectId}/risk-case-v1g15`,
      });

    assert(
      getResponse.statusCode ===
        200,

      `G15 GET failed: ${getResponse.statusCode} ${getResponse.body}`,
    );

    const first =
      getResponse.json();

    assert(
      first.exists ===
        true,

      'G15 GET must find risk case',
    );

    assert(
      first.riskCase.status ===
        'OPEN',

      `Expected OPEN, got ${first.riskCase.status}`,
    );


    const acknowledgeResponse =
      await app.inject({
        method:
          'POST',

        url:
          `/api/v1/project-risk-cases-v1g15/${riskId}/acknowledge`,
      });

    assert(
      acknowledgeResponse.statusCode ===
        200,

      `G15 acknowledge failed: ${acknowledgeResponse.statusCode} ${acknowledgeResponse.body}`,
    );

    assert(
      acknowledgeResponse
        .json()
        .status ===
        'ACKNOWLEDGED',

      'G15 risk not acknowledged',
    );


    const assignResponse =
      await app.inject({
        method:
          'PUT',

        url:
          `/api/v1/project-risk-cases-v1g15/${riskId}/assignee`,

        payload: {
          assigneeId:
            userId,
        },
      });

    assert(
      assignResponse.statusCode ===
        200,

      `G15 assignment failed: ${assignResponse.statusCode} ${assignResponse.body}`,
    );


    const mitigationResponse =
      await app.inject({
        method:
          'POST',

        url:
          `/api/v1/project-risk-cases-v1g15/${riskId}/mitigations`,

        payload: {
          mitigationObjectId:
            mitigationId,

          notes:
            'Corrective mitigation action.',
        },
      });

    assert(
      mitigationResponse.statusCode ===
        201,

      `G15 mitigation failed: ${mitigationResponse.statusCode} ${mitigationResponse.body}`,
    );

    const mitigation =
      mitigationResponse.json();

    assert(
      mitigation.relation
        .relationType ===
        'MITIGATES',

      'G15 MITIGATES relation missing',
    );

    assert(
      mitigation.riskCase
        .status ===
        'MITIGATING',

      'G15 risk must be MITIGATING',
    );


    const resolveResponse =
      await app.inject({
        method:
          'POST',

        url:
          `/api/v1/project-risk-cases-v1g15/${riskId}/resolve`,

        payload: {
          resolutionNote:
            'Mitigation validated and risk closed.',
        },
      });

    assert(
      resolveResponse.statusCode ===
        200,

      `G15 resolve failed: ${resolveResponse.statusCode} ${resolveResponse.body}`,
    );

    assert(
      resolveResponse
        .json()
        .status ===
        'RESOLVED',

      'G15 risk must be RESOLVED',
    );


    const reopen =
      await withTenant(
        tenantId,

        async (tx) =>
          syncProjectRiskCaseV1g15(
            tx,
            {
              tenantId,

              project: {
                id:
                  projectId,

                title:
                  'G15 Risk Case Smoke Project',

                workspaceId,

                ownerId:
                  userId,
              },

              snapshot: {
                riskLevel:
                  'CRITICAL',

                drivers: [
                  'COST_OVERRUN',
                  'SCHEDULE_DELAY',
                ],

                fingerprint:
                  'g15-critical-2',

                financialHealth:
                  'CRITICAL',

                scheduleHealth:
                  'CRITICAL',
              },
            },
          ),
      );

    assert(
      reopen.action ===
        'REOPENED',

      `Expected REOPENED, got ${reopen.action}`,
    );

    assert(
      reopen.riskCase
        ?.status ===
        'OPEN',

      'Reopened G15 risk must be OPEN',
    );


    console.log(
      JSON.stringify({
        projectRiskCaseV1g15:
          'PASS',

        riskObjectCanonical:
          true,

        riskCaseCreated:
          true,

        acknowledged:
          true,

        assignable:
          true,

        mitigationRelation:
          'MITIGATES',

        mitigationStatus:
          'MITIGATING',

        manuallyResolved:
          true,

        reopenedOnRiskReturn:
          true,

        finalStatus:
          reopen.riskCase
            ?.status,

        separateRiskTable:
          false,

        canonicalObjectGraph:
          true,
      }),
    );
  } finally {
    await withTenant(
      tenantId,

      async (tx) => {
        if (riskId) {
          await tx.objectRelation
            .deleteMany({
              where: {
                tenantId,

                OR: [
                  {
                    sourceObjectId:
                      riskId,
                  },
                  {
                    targetObjectId:
                      riskId,
                  },
                ],
              },
            });

          await tx.auditLog.deleteMany({
            where: {
              tenantId,

              resourceId:
                riskId,
            },
          });

          await tx.domainEvent
            .deleteMany({
              where: {
                tenantId,

                aggregateId:
                  riskId,
              },
            });

          await tx.nexusObject
            .deleteMany({
              where: {
                tenantId,

                id:
                  riskId,
              },
            });
        }

        await tx.auditLog.deleteMany({
          where: {
            tenantId,

            resourceId:
              projectId,
          },
        });

        await tx.nexusObject
          .deleteMany({
            where: {
              tenantId,

              id: {
                in: [
                  mitigationId,
                  projectId,
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
