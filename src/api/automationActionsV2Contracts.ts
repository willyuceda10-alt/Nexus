export type ApiNotificationPriorityV2 = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface PublishInternalNotificationAutomationV2Input {
  triggerEventType: string;
  condition?: {
    path: string;
    operator: 'EQ' | 'NEQ' | 'GT' | 'GTE' | 'LT' | 'LTE' | 'CONTAINS' | 'EXISTS';
    value?: string | number | boolean | null;
  };
  targetUserId: string;
  notificationTitle: string;
  notificationBody?: string | null;
  priority?: ApiNotificationPriorityV2;
  requiresAction?: boolean;
  activate?: boolean;
  changeNote?: string | null;
}

export interface PublishInternalNotificationAutomationV2Response {
  automationId: string;
  versionId: string;
  version: number;
  triggerEventType: string;
  actionType: 'SEND_INTERNAL_NOTIFICATION';
  active: boolean;
  createdAt: string;
}
