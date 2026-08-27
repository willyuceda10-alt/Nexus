export type ApiNotificationPriorityV1 = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface ApiExternalNotificationPreferenceV1 {
  enabled: boolean;
  minimumPriority: ApiNotificationPriorityV1;
  onlyRequiresAction: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  timezone: string;
}

export interface ApiNotificationPreferencesV1 {
  version: 1;
  internal: {
    enabled: true;
    canonical: true;
  };
  outlookEmail: ApiExternalNotificationPreferenceV1;
  teamsActivity: ApiExternalNotificationPreferenceV1;
}

export interface UpdateApiNotificationPreferencesV1Input {
  outlookEmail: ApiExternalNotificationPreferenceV1;
  teamsActivity: ApiExternalNotificationPreferenceV1;
}

export interface ApiNotificationCapabilitiesV1 {
  graphDeliveryEnabled: boolean;
  outlookConfigured: boolean;
  teamsConfigured: boolean;
  notificationWorkerEnabled: boolean;
}
