export type ExternalNotificationChannelV1 = 'OUTLOOK_EMAIL' | 'TEAMS_ACTIVITY';
export type NotificationPriorityV1 = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface ExternalNotificationPreferenceV1 {
  channel: ExternalNotificationChannelV1;
  enabled: boolean;
  minimumPriority: NotificationPriorityV1;
  onlyRequiresAction: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  timezone: string;
}

export interface NotificationIntentV1 {
  priority: NotificationPriorityV1;
  requiresAction: boolean;
  occurredAt: Date;
}

const PRIORITY_RANK: Record<NotificationPriorityV1, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export function externalDeliveryDecisionV1(
  preference: ExternalNotificationPreferenceV1,
  intent: NotificationIntentV1,
): { queue: boolean; reason: string } {
  if (!preference.enabled) return { queue: false, reason: 'DISABLED' };
  if (PRIORITY_RANK[intent.priority] < PRIORITY_RANK[preference.minimumPriority]) {
    return { queue: false, reason: 'BELOW_PRIORITY' };
  }
  if (preference.onlyRequiresAction && !intent.requiresAction) {
    return { queue: false, reason: 'ACTION_ONLY' };
  }
  return { queue: true, reason: 'ENABLED' };
}

export function defaultExternalNotificationPreferencesV1(timezone = 'UTC'): ExternalNotificationPreferenceV1[] {
  return [
    { channel: 'OUTLOOK_EMAIL', enabled: false, minimumPriority: 'HIGH', onlyRequiresAction: false, quietHoursStart: null, quietHoursEnd: null, timezone },
    { channel: 'TEAMS_ACTIVITY', enabled: false, minimumPriority: 'HIGH', onlyRequiresAction: true, quietHoursStart: null, quietHoursEnd: null, timezone },
  ];
}
