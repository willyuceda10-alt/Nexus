import {
  Prisma,
} from '@prisma/client';

export type ProjectRiskMinimumLevelV1g14 =
  | 'HIGH'
  | 'CRITICAL';

export interface ProjectRiskNotificationPreferencesV1g14 {
  version: 'v1g14';

  enabled: boolean;

  minimumRiskLevel:
    ProjectRiskMinimumLevelV1g14;

  highCooldownHours: number;
  criticalCooldownHours: number;

  notifyOnEscalation: boolean;
  notifyOnDriverChange: boolean;
  notifyOnReentry: boolean;
  notifyOnCooldownReminder: boolean;
}

export type ProjectRiskNotificationPreferenceRowV1g14 = {
  enabled: boolean;

  minimum_risk_level:
    ProjectRiskMinimumLevelV1g14;

  high_cooldown_hours: number;
  critical_cooldown_hours: number;

  notify_on_escalation: boolean;
  notify_on_driver_change: boolean;
  notify_on_reentry: boolean;
  notify_on_cooldown_reminder: boolean;
};

export function defaultProjectRiskNotificationPreferencesV1g14():
ProjectRiskNotificationPreferencesV1g14 {
  return {
    version:
      'v1g14',

    enabled:
      true,

    minimumRiskLevel:
      'HIGH',

    highCooldownHours:
      24,

    criticalCooldownHours:
      6,

    notifyOnEscalation:
      true,

    notifyOnDriverChange:
      true,

    notifyOnReentry:
      true,

    notifyOnCooldownReminder:
      true,
  };
}

export function serializeProjectRiskNotificationPreferencesV1g14(
  row:
    ProjectRiskNotificationPreferenceRowV1g14 |
    null |
    undefined,
):
ProjectRiskNotificationPreferencesV1g14 {
  if (!row) {
    return defaultProjectRiskNotificationPreferencesV1g14();
  }

  return {
    version:
      'v1g14',

    enabled:
      row.enabled,

    minimumRiskLevel:
      row.minimum_risk_level,

    highCooldownHours:
      row.high_cooldown_hours,

    criticalCooldownHours:
      row.critical_cooldown_hours,

    notifyOnEscalation:
      row.notify_on_escalation,

    notifyOnDriverChange:
      row.notify_on_driver_change,

    notifyOnReentry:
      row.notify_on_reentry,

    notifyOnCooldownReminder:
      row.notify_on_cooldown_reminder,
  };
}

export async function loadProjectRiskNotificationPreferencesV1g14(
  tx:
    Prisma.TransactionClient,

  tenantId:
    string,

  userId:
    string,
):
Promise<ProjectRiskNotificationPreferencesV1g14> {
  const rows =
    await tx.$queryRaw<
      ProjectRiskNotificationPreferenceRowV1g14[]
    >(Prisma.sql`
      SELECT
        enabled,
        minimum_risk_level,
        high_cooldown_hours,
        critical_cooldown_hours,
        notify_on_escalation,
        notify_on_driver_change,
        notify_on_reentry,
        notify_on_cooldown_reminder
      FROM
        project_risk_notification_preferences_v1g14
      WHERE
        tenant_id =
          ${tenantId}::uuid
        AND user_id =
          ${userId}::uuid
      LIMIT 1
    `);

  return serializeProjectRiskNotificationPreferencesV1g14(
    rows[0],
  );
}
