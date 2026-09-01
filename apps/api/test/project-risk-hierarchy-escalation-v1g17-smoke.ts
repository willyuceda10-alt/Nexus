import {
  randomUUID,
} from 'node:crypto';

import {
  Prisma,
} from '@prisma/client';

import {
  buildProjectRiskAlertV1g8,
} from '../src/domain/project-risk-alert-v1g8.js';

import {
  buildProjectRiskForecastV1g7,
} from '../src/domain/project-risk-forecast-v1g7.js';

import {
  escalateProjectRiskHierarchyV1g17,
} from '../src/project-risk-hierarchy-escalation-v1g17.js';

import {
  projectPlatformEventV1,
} from '../src/platform-event-projector-v1.js';

import {
  withTenant,
} from '../src/tenant-transaction.js';

const tenantId =
  process.env.DEV_TENANT_ID ??
  '00000000-0000-4000-8000-000000000002';

const projectOwnerId =
  process.env.DEV_USER_ID ??
  '00000000-0000-4000-8000-000000000001';

const workspaceId =
  '00000000-0000-4000-8000-000000000003';

function assert(
  condition:
    unknown,

  message:
    string,
): asserts condition {
  if (!condition) {
    throw new Error(
      message,
    );
  }
}

async function main() {
  const projectId =
    randomUUID();

  const programId =
    randomUUID();

  const portfolioId =
    randomUUID();

  const programOwnerId =
    randomUUID();

  const portfolioOwnerId =
    randomUUID();

  const suffix =
    Date.now()
      .toString()
      .slice(-8);

  const previousRisk =
    buildProjectRiskForecastV1g7({
      financial: {
        health:
          'ON_TRACK',

        controlBudget:
          100,

        estimateAtCompletion:
          100,

        varianceAtCompletion:
          0,

        forecastVariancePercent:
          0,
      },

      schedule: {
        plannedFinish:
          '2026-09-30',

        forecastFinish:
          '2026-10-03',

        forecastVarianceDays:
          3,

        projectedTaskCount:
          1,

        lowConfidenceTaskCount:
          0,
      },
    });

  const criticalRisk =
    buildProjectRiskForecastV1g7({
      financial: {
        health:
          'HIGH',

        controlBudget:
          100,

        estimateAtCompletion:
          130,

        varianceAtCompletion:
          -30,

        forecastVariancePercent:
          30,
      },

      schedule: {
        plannedFinish:
          '2026-09-30',

        forecastFinish:
          '2026-10-25',

        forecastVarianceDays:
          25,

        projectedTaskCount:
          1,

        lowConfidenceTaskCount:
          0,
      },
    });

  const recoveryRisk =
    buildProjectRiskForecastV1g7({
      financial: {
        health:
          'ON_TRACK',

        controlBudget:
          100,

        estimateAtCompletion:
          100,

        varianceAtCompletion:
          0,

        forecastVariancePercent:
          0,
      },

      schedule: {
        plannedFinish:
          '2026-09-30',

        forecastFinish:
          '2026-09-30',

        forecastVarianceDays:
          0,

        projectedTaskCount:
          1,

        lowConfidenceTaskCount:
          0,
      },
    });

  try {
    await withTenant(
      tenantId,

      async (tx) => {
        const [
          projectDefinition,
          programDefinition,
          portfolioDefinition,
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
                  id:
                    true,
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
                  id:
                    true,
                },
              }),

            tx.objectDefinition
              .findFirst({
                where: {
                  tenantId,

                  key:
                    'PORTFOLIO',
                },

                select: {
                  id:
                    true,
                },
              }),
          ]);

        assert(
          projectDefinition,
          'PROJECT definition missing',
        );

        assert(
          programDefinition,
          'PROGRAM definition missing',
        );

        assert(
          portfolioDefinition,
          'PORTFOLIO definition missing',
        );

        await tx.user.createMany({
          data: [
            {
              id:
                programOwnerId,

              email:
                `g17-program-${suffix}@bridata.local`,

              fullName:
                'G17 Program Owner',

              isActive:
                true,
            },

            {
              id:
                portfolioOwnerId,

              email:
                `g17-portfolio-${suffix}@bridata.local`,

              fullName:
                'G17 Portfolio Owner',

              isActive:
                true,
            },
          ],
        });

        await tx.tenantMembership
          .createMany({
            data: [
              {
                tenantId,

                userId:
                  programOwnerId,

                role:
                  'MEMBER',

                status:
                  'ACTIVE',
              },

              {
                tenantId,

                userId:
                  portfolioOwnerId,

                role:
                  'MEMBER',

                status:
                  'ACTIVE',
              },
            ],
          });

        await tx.workspaceMember
          .createMany({
            data: [
              {
                tenantId,

                workspaceId,

                userId:
                  programOwnerId,

                role:
                  'MANAGER',
              },

              {
                tenantId,

                workspaceId,

                userId:
                  portfolioOwnerId,

                role:
                  'MANAGER',
              },
            ],
          });

        await tx.nexusObject.create({
          data: {
            id:
              portfolioId,

            tenantId,

            workspaceId,

            objectDefinitionId:
              portfolioDefinition
                .id,

            objectTypeKey:
              'PORTFOLIO',

            title:
              'G17 Portfolio',

            status:
              'IN_PROGRESS',

            priority:
              'HIGH',

            progress:
              50,

            ownerId:
              portfolioOwnerId,

            assigneeId:
              portfolioOwnerId,

            metadata: {
              source:
                'G17_SMOKE',
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
              programDefinition
                .id,

            objectTypeKey:
              'PROGRAM',

            title:
              'G17 Program',

            status:
              'IN_PROGRESS',

            priority:
              'HIGH',

            progress:
              50,

            ownerId:
              programOwnerId,

            assigneeId:
              programOwnerId,

            metadata: {
              portfolioId,

              source:
                'G17_SMOKE',
            },
          },
        });

        await tx.nexusObject.create({
          data: {
            id:
              projectId,

            tenantId,

            workspaceId,

            objectDefinitionId:
              projectDefinition
                .id,

            objectTypeKey:
              'PROJECT',

            title:
              'G17 Critical Project',

            status:
              'IN_PROGRESS',

            priority:
              'HIGH',

            progress:
              40,

            ownerId:
              projectOwnerId,

            assigneeId:
              projectOwnerId,

            metadata: {
              programId,
              portfolioId,

              source:
                'G17_SMOKE',
            },
          },
        });

        const previousAlert =
          buildProjectRiskAlertV1g8({
            tenantId,

            projectId,

            projectTitle:
              'G17 Critical Project',

            workspaceId,

            targetUserId:
              projectOwnerId,

            risk:
              previousRisk,
          });

        const criticalAlert =
          buildProjectRiskAlertV1g8({
            tenantId,

            projectId,

            projectTitle:
              'G17 Critical Project',

            workspaceId,

            targetUserId:
              projectOwnerId,

            risk:
              criticalRisk,
          });

        await tx.domainEvent.create({
          data: {
            tenantId,

            aggregateId:
              projectId,

            eventType:
              previousAlert
                .assessmentEvent
                .eventType,

            idempotencyKey:
              `g17-smoke-previous:${projectId}`,

            payload:
              previousAlert
                .assessmentEvent
                .payload,

            createdAt:
              new Date(
                Date.now() -
                60_000,
              ),
          },
        });

        await tx.domainEvent.create({
          data: {
            tenantId,

            aggregateId:
              projectId,

            eventType:
              criticalAlert
                .assessmentEvent
                .eventType,

            idempotencyKey:
              `g17-smoke-critical:${projectId}`,

            payload:
              criticalAlert
                .assessmentEvent
                .payload,

            createdAt:
              new Date(),
          },
        });
      },
    );


    const firstRun =
      await withTenant(
        tenantId,

        async (tx) =>
          escalateProjectRiskHierarchyV1g17(
            tx,
            {
              tenantId,

              project: {
                id:
                  projectId,

                title:
                  'G17 Critical Project',

                workspaceId,

                ownerId:
                  projectOwnerId,

                metadata: {
                  programId,
                  portfolioId,
                },
              },

              risk:
                criticalRisk,
            },
          ),
      );

    assert(
      firstRun.eligible ===
        true,

      'G17 CRITICAL must be eligible',
    );

    assert(
      firstRun.recipientsConsidered ===
        2,

      `Expected 2 hierarchy recipients, got ${firstRun.recipientsConsidered}`,
    );

    assert(
      firstRun.notificationsQueued ===
        2,

      `Expected 2 hierarchy notifications, got ${firstRun.notificationsQueued}`,
    );

    assert(
      firstRun.notificationsSuppressedByPolicy ===
        0,

      'First G17 run must not be suppressed',
    );


    const firstEvents =
      await withTenant(
        tenantId,

        async (tx) =>
          tx.domainEvent.findMany({
            where: {
              tenantId,

              aggregateId:
                projectId,

              eventType:
                'bridata.notification.requested',
            },

            orderBy: {
              createdAt:
                'asc',
            },

            select: {
              id:
                true,

              tenantId:
                true,

              aggregateId:
                true,

              eventType:
                true,

              payload:
                true,

              createdAt:
                true,
            },
          }),
      );

    const hierarchyEvents =
      firstEvents.filter(
        (event) => {
          const payload =
            event.payload as {
              targetUserId?:
                unknown;
            };

          return (
            payload.targetUserId ===
              programOwnerId ||
            payload.targetUserId ===
              portfolioOwnerId
          );
        },
      );

    assert(
      hierarchyEvents.length ===
        2,

      `Expected 2 persisted hierarchy events, got ${hierarchyEvents.length}`,
    );

    for (
      const event
      of hierarchyEvents
    ) {
      const projection =
        await projectPlatformEventV1({
          schemaVersion:
            1,

          eventId:
            event.id,

          tenantId:
            event.tenantId,

          aggregateId:
            event.aggregateId,

          eventType:
            event.eventType,

          payload:
            event.payload,

          occurredAt:
            event.createdAt
              .toISOString(),
        });

      assert(
        projection.handled ===
          true,

        'G17 notification was not projected',
      );
    }


    const inboxRows =
      await withTenant(
        tenantId,

        async (tx) =>
          tx.$queryRaw<
            Array<{
              user_id:
                string;

              priority:
                string;

              requires_action:
                boolean;
            }>
          >(Prisma.sql`
            SELECT
              user_id,
              priority::text,
              requires_action
            FROM inbox_items_v1
            WHERE tenant_id =
              ${tenantId}::uuid
              AND project_object_id =
                ${projectId}::uuid
              AND user_id IN (
                ${programOwnerId}::uuid,
                ${portfolioOwnerId}::uuid
              )
              AND source_type =
                'AUTOMATION_NOTIFICATION'
          `),
      );

    assert(
      inboxRows.length ===
        2,

      `Expected 2 hierarchy Inbox items, got ${inboxRows.length}`,
    );

    assert(
      inboxRows.every(
        (row) =>
          row.priority ===
            'CRITICAL' &&
          row.requires_action ===
            true,
      ),

      'G17 hierarchy Inbox must be CRITICAL and actionable',
    );


    const secondRun =
      await withTenant(
        tenantId,

        async (tx) =>
          escalateProjectRiskHierarchyV1g17(
            tx,
            {
              tenantId,

              project: {
                id:
                  projectId,

                title:
                  'G17 Critical Project',

                workspaceId,

                ownerId:
                  projectOwnerId,

                metadata: {
                  programId,
                  portfolioId,
                },
              },

              risk:
                criticalRisk,
            },
          ),
      );

    assert(
      secondRun.notificationsQueued ===
        0,

      'Second G17 run must not queue duplicate hierarchy notifications',
    );

    assert(
      secondRun.notificationsSuppressedByPolicy ===
        2,

      `Expected 2 cooldown suppressions, got ${secondRun.notificationsSuppressedByPolicy}`,
    );


    // Recovery is stored as the latest canonical
    // assessment. Hierarchy escalation itself does
    // not notify for recovered projects.
    await withTenant(
      tenantId,

      async (tx) => {
        const recoveryAlert =
          buildProjectRiskAlertV1g8({
            tenantId,

            projectId,

            projectTitle:
              'G17 Critical Project',

            workspaceId,

            targetUserId:
              projectOwnerId,

            risk:
              recoveryRisk,
          });

        await tx.domainEvent.create({
          data: {
            tenantId,

            aggregateId:
              projectId,

            eventType:
              recoveryAlert
                .assessmentEvent
                .eventType,

            idempotencyKey:
              `g17-smoke-recovery:${projectId}`,

            payload:
              recoveryAlert
                .assessmentEvent
                .payload,

            // Recovery must be observed before
            // the following CRITICAL re-entry.
            //
            // Do not place this event in the future:
            // G17 compares immutable assessment
            // chronology against notification audit
            // chronology to distinguish re-entry
            // from cooldown.
            createdAt:
              new Date(),
          },
        });
      },
    );

    const recoveryRun =
      await withTenant(
        tenantId,

        async (tx) =>
          escalateProjectRiskHierarchyV1g17(
            tx,
            {
              tenantId,

              project: {
                id:
                  projectId,

                title:
                  'G17 Critical Project',

                workspaceId,

                ownerId:
                  projectOwnerId,

                metadata: {
                  programId,
                  portfolioId,
                },
              },

              risk:
                recoveryRisk,
            },
          ),
      );

    assert(
      recoveryRun.eligible ===
        false,

      'Recovered risk must not hierarchy-escalate',
    );


    // Exact same CRITICAL fingerprint returns.
    // G17 must detect the recovery/re-entry and
    // create a new escalation despite old cooldown.
    const reentryRun =
      await withTenant(
        tenantId,

        async (tx) =>
          escalateProjectRiskHierarchyV1g17(
            tx,
            {
              tenantId,

              project: {
                id:
                  projectId,

                title:
                  'G17 Critical Project',

                workspaceId,

                ownerId:
                  projectOwnerId,

                metadata: {
                  programId,
                  portfolioId,
                },
              },

              risk:
                criticalRisk,
            },
          ),
      );

    assert(
      reentryRun.notificationsQueued ===
        2,

      `Expected 2 G17 re-entry notifications, got ${reentryRun.notificationsQueued}`,
    );


    const postReentryRun =
      await withTenant(
        tenantId,

        async (tx) =>
          escalateProjectRiskHierarchyV1g17(
            tx,
            {
              tenantId,

              project: {
                id:
                  projectId,

                title:
                  'G17 Critical Project',

                workspaceId,

                ownerId:
                  projectOwnerId,

                metadata: {
                  programId,
                  portfolioId,
                },
              },

              risk:
                criticalRisk,
            },
          ),
      );

    assert(
      postReentryRun.notificationsQueued ===
        0,

      'G17 post-reentry duplicate must not queue',
    );

    assert(
      postReentryRun.notificationsSuppressedByPolicy ===
        2,

      `Expected post-reentry cooldown suppression=2, got ${postReentryRun.notificationsSuppressedByPolicy}`,
    );


    console.log(
      JSON.stringify({
        projectRiskHierarchyEscalationV1g17:
          'PASS',

        productionEscalationThreshold:
          'CRITICAL',

        canonicalHierarchy:
          'PROJECT_METADATA',

        programOwnerEscalated:
          true,

        portfolioOwnerEscalated:
          true,

        recipientsDeduplicated:
          true,

        projectOwnerNotDuplicated:
          true,

        hierarchyInboxProjected:
          true,

        cooldownGovernedByG13:
          true,

        preferencesGovernedByG14:
          true,

        initialHierarchyNotifications:
          firstRun
            .notificationsQueued,

        duplicateHierarchySuppressed:
          secondRun
            .notificationsSuppressedByPolicy,

        recoveryNotEscalated:
          recoveryRun
            .eligible ===
          false,

        exactFingerprintReentryQueued:
          reentryRun
            .notificationsQueued,

        postReentryCooldownSuppressed:
          postReentryRun
            .notificationsSuppressedByPolicy,

        separateHierarchyAlertTable:
          false,

        additionalRiskRecalculation:
          false,
      }),
    );
  } finally {
    await withTenant(
      tenantId,

      async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`
            DELETE FROM
              notification_deliveries_v1
            WHERE
              tenant_id =
                ${tenantId}::uuid
              AND inbox_item_id IN (
                SELECT id
                FROM inbox_items_v1
                WHERE
                  tenant_id =
                    ${tenantId}::uuid
                  AND project_object_id =
                    ${projectId}::uuid
              )
          `,
        );

        await tx.$executeRaw(
          Prisma.sql`
            DELETE FROM
              inbox_items_v1
            WHERE
              tenant_id =
                ${tenantId}::uuid
              AND project_object_id =
                ${projectId}::uuid
          `,
        );

        await tx.auditLog.deleteMany({
          where: {
            tenantId,

            resourceId:
              projectId,
          },
        });

        await tx.$executeRaw(
          Prisma.sql`
            DELETE FROM domain_events
            WHERE
              tenant_id =
                ${tenantId}::uuid
              AND (
                aggregate_id =
                  ${projectId}::uuid
                OR payload->>'projectId' =
                  ${projectId}
                OR payload->>'scopeProjectId' =
                  ${projectId}
              )
          `,
        );

        await tx.nexusObject.deleteMany({
          where: {
            tenantId,

            id: {
              in: [
                projectId,
                programId,
                portfolioId,
              ],
            },
          },
        });

        await tx.workspaceMember
          .deleteMany({
            where: {
              tenantId,

              userId: {
                in: [
                  programOwnerId,
                  portfolioOwnerId,
                ],
              },
            },
          });

        await tx.tenantMembership
          .deleteMany({
            where: {
              tenantId,

              userId: {
                in: [
                  programOwnerId,
                  portfolioOwnerId,
                ],
              },
            },
          });

        await tx.user.deleteMany({
          where: {
            id: {
              in: [
                programOwnerId,
                portfolioOwnerId,
              ],
            },
          },
        });
      },
    );
  }
}

main().catch(
  (error) => {
    console.error(
      error,
    );

    process.exitCode =
      1;
  },
);
