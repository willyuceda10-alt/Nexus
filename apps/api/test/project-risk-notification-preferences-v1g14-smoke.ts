import {
  Prisma,
} from '@prisma/client';

import {
  buildApp,
} from '../src/app.js';

import {
  loadProjectRiskNotificationPreferencesV1g14,
} from '../src/domain/project-risk-notification-preferences-v1g14.js';

import {
  buildProjectRiskAutomaticNotificationPolicyV1g13,
} from '../src/domain/project-risk-notification-policy-v1g13.js';

import {
  withTenant,
} from '../src/tenant-transaction.js';

const tenantId =
  process.env.DEV_TENANT_ID ??
  '00000000-0000-4000-8000-000000000002';

const userId =
  process.env.DEV_USER_ID ??
  '00000000-0000-4000-8000-000000000001';

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const app =
    await buildApp();

  await app.ready();

  try {
    await withTenant(
      tenantId,

      async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`
            DELETE FROM
              project_risk_notification_preferences_v1g14
            WHERE
              tenant_id =
                ${tenantId}::uuid
              AND user_id =
                ${userId}::uuid
          `,
        );
      },
    );

    const initialResponse =
      await app.inject({
        method:
          'GET',

        url:
          '/api/v1/notification-preferences-v1',
      });

    assert(
      initialResponse.statusCode ===
        200,

      `G14 initial GET failed: ${initialResponse.statusCode} ${initialResponse.body}`,
    );

    const initial =
      initialResponse.json();

    assert(
      initial.projectRisk
        .enabled === true,

      'G14 default risk notification must be enabled',
    );

    assert(
      initial.projectRisk
        .minimumRiskLevel ===
        'HIGH',

      'G14 default threshold must be HIGH',
    );

    assert(
      initial.projectRisk
        .highCooldownHours ===
        24,

      'G14 default HIGH cooldown must be 24h',
    );

    assert(
      initial.projectRisk
        .criticalCooldownHours ===
        6,

      'G14 default CRITICAL cooldown must be 6h',
    );

    const updateResponse =
      await app.inject({
        method:
          'PUT',

        url:
          '/api/v1/notification-preferences-v1',

        payload: {
          outlookEmail:
            initial.outlookEmail,

          teamsActivity:
            initial.teamsActivity,

          projectRisk: {
            enabled:
              true,

            minimumRiskLevel:
              'CRITICAL',

            highCooldownHours:
              48,

            criticalCooldownHours:
              12,

            notifyOnEscalation:
              true,

            notifyOnDriverChange:
              false,

            notifyOnReentry:
              false,

            notifyOnCooldownReminder:
              false,
          },
        },
      });

    assert(
      updateResponse.statusCode ===
        204,

      `G14 PUT failed: ${updateResponse.statusCode} ${updateResponse.body}`,
    );

    const getResponse =
      await app.inject({
        method:
          'GET',

        url:
          '/api/v1/notification-preferences-v1',
      });

    assert(
      getResponse.statusCode ===
        200,

      `G14 GET after update failed: ${getResponse.statusCode} ${getResponse.body}`,
    );

    const updated =
      getResponse.json();

    assert(
      updated.projectRisk
        .minimumRiskLevel ===
        'CRITICAL',

      'G14 threshold persistence failed',
    );

    assert(
      updated.projectRisk
        .criticalCooldownHours ===
        12,

      'G14 cooldown persistence failed',
    );

    assert(
      updated.projectRisk
        .notifyOnDriverChange ===
        false,

      'G14 driver preference persistence failed',
    );

    const loaded =
      await withTenant(
        tenantId,

        async (tx) =>
          loadProjectRiskNotificationPreferencesV1g14(
            tx,
            tenantId,
            userId,
          ),
      );

    assert(
      loaded.minimumRiskLevel ===
        'CRITICAL',

      'G14 evaluator preference loader failed',
    );

    const highDecision =
      buildProjectRiskAutomaticNotificationPolicyV1g13({
        current: {
          riskLevel:
            'HIGH',

          drivers:
            ['COST_OVERRUN'],

          fingerprint:
            'g14-high',
        },

        previousAssessment:
          null,

        lastNotification:
          null,

        enabled:
          loaded.enabled,

        minimumRiskLevel:
          loaded.minimumRiskLevel,

        highCooldownHours:
          loaded.highCooldownHours,

        criticalCooldownHours:
          loaded.criticalCooldownHours,

        notifyOnEscalation:
          loaded.notifyOnEscalation,

        notifyOnDriverChange:
          loaded.notifyOnDriverChange,

        notifyOnReentry:
          loaded.notifyOnReentry,

        notifyOnCooldownReminder:
          loaded.notifyOnCooldownReminder,
      });

    assert(
      highDecision.shouldNotify ===
        false,

      'G14 CRITICAL threshold must suppress HIGH alert',
    );

    assert(
      highDecision.reason ===
        'BELOW_USER_THRESHOLD',

      `Unexpected G14 HIGH suppression reason: ${highDecision.reason}`,
    );

    const criticalDecision =
      buildProjectRiskAutomaticNotificationPolicyV1g13({
        current: {
          riskLevel:
            'CRITICAL',

          drivers:
            ['COST_OVERRUN'],

          fingerprint:
            'g14-critical',
        },

        previousAssessment:
          null,

        lastNotification:
          null,

        enabled:
          loaded.enabled,

        minimumRiskLevel:
          loaded.minimumRiskLevel,

        highCooldownHours:
          loaded.highCooldownHours,

        criticalCooldownHours:
          loaded.criticalCooldownHours,

        notifyOnEscalation:
          loaded.notifyOnEscalation,

        notifyOnDriverChange:
          loaded.notifyOnDriverChange,

        notifyOnReentry:
          loaded.notifyOnReentry,

        notifyOnCooldownReminder:
          loaded.notifyOnCooldownReminder,
      });

    assert(
      criticalDecision.shouldNotify ===
        true,

      'G14 CRITICAL threshold must allow CRITICAL',
    );

    assert(
      criticalDecision.cooldownHours ===
        12,

      `Expected custom CRITICAL cooldown=12, got ${criticalDecision.cooldownHours}`,
    );

    console.log(
      JSON.stringify({
        projectRiskNotificationPreferencesV1g14:
          'PASS',

        apiSurface:
          'notification-preferences-v1',

        userConfigurable:
          true,

        defaultMinimumRiskLevel:
          initial.projectRisk
            .minimumRiskLevel,

        configuredMinimumRiskLevel:
          updated.projectRisk
            .minimumRiskLevel,

        configuredHighCooldownHours:
          updated.projectRisk
            .highCooldownHours,

        configuredCriticalCooldownHours:
          updated.projectRisk
            .criticalCooldownHours,

        highSuppressed:
          highDecision
            .shouldNotify ===
          false,

        highSuppressionReason:
          highDecision.reason,

        criticalAllowed:
          criticalDecision
            .shouldNotify ===
          true,

        internalInboxCanonical:
          initial.internal
            .canonical ===
          true,

        externalPreferencesPreserved:
          true,
      }),
    );
  } finally {
    await withTenant(
      tenantId,

      async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`
            DELETE FROM
              project_risk_notification_preferences_v1g14
            WHERE
              tenant_id =
                ${tenantId}::uuid
              AND user_id =
                ${userId}::uuid
          `,
        );

        await tx.auditLog.deleteMany({
          where: {
            tenantId,
            userId,

            action:
              'NOTIFICATION_PREFERENCES_UPDATED',
          },
        });

        await tx.domainEvent.deleteMany({
          where: {
            tenantId,
            aggregateId:
              userId,

            eventType:
              'bridata.notification.preferences.updated',
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
