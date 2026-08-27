import { describe, expect, it } from 'vitest';
import { InternalNotificationValidationErrorV1, parseInternalNotificationRequestV1 } from './internal-notification-v1.js';
import type { AutomationEventEnvelopeV1 } from './automation-engine-v1.js';

const baseEvent: AutomationEventEnvelopeV1 = {
  schemaVersion: 1,
  eventId: '00000000-0000-4000-8000-000000000001',
  tenantId: '00000000-0000-4000-8000-000000000002',
  aggregateId: '00000000-0000-4000-8000-000000000003',
  eventType: 'bridata.notification.requested',
  payload: {
    targetUserId: '00000000-0000-4000-8000-000000000004',
    notificationTitle: 'Material crítico',
    notificationBody: 'La actividad requiere atención.',
    priority: 'critical',
    requiresAction: true,
    scopeWorkspaceId: '00000000-0000-4000-8000-000000000005',
    scopeProjectId: '00000000-0000-4000-8000-000000000006',
  },
};

describe('internal notification v1', () => {
  it('parses a valid internal notification request', () => {
    expect(parseInternalNotificationRequestV1(baseEvent)).toEqual({
      eventId: baseEvent.eventId,
      tenantId: baseEvent.tenantId,
      targetUserId: '00000000-0000-4000-8000-000000000004',
      title: 'Material crítico',
      body: 'La actividad requiere atención.',
      priority: 'CRITICAL',
      requiresAction: true,
      workspaceId: '00000000-0000-4000-8000-000000000005',
      projectId: '00000000-0000-4000-8000-000000000006',
    });
  });

  it('ignores unrelated domain events', () => {
    expect(parseInternalNotificationRequestV1({ ...baseEvent, eventType: 'bridata.object.created' })).toBeNull();
  });

  it('rejects an invalid recipient', () => {
    expect(() => parseInternalNotificationRequestV1({
      ...baseEvent,
      payload: { ...(baseEvent.payload as Record<string, unknown>), targetUserId: 'not-a-uuid' },
    })).toThrow(InternalNotificationValidationErrorV1);
  });

  it('rejects unknown priorities', () => {
    expect(() => parseInternalNotificationRequestV1({
      ...baseEvent,
      payload: { ...(baseEvent.payload as Record<string, unknown>), priority: 'URGENT' },
    })).toThrow(/priority/);
  });
});
