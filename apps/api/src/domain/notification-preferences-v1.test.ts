import { describe, expect, it } from 'vitest';
import { defaultExternalNotificationPreferencesV1, externalDeliveryDecisionV1 } from './notification-preferences-v1.js';

describe('notification preference policy v1', () => {
  it('keeps external channels disabled by default', () => {
    expect(defaultExternalNotificationPreferencesV1('UTC').every((item) => item.enabled === false)).toBe(true);
  });

  it('queues enabled notifications that meet the priority threshold', () => {
    expect(externalDeliveryDecisionV1({
      channel: 'OUTLOOK_EMAIL',
      enabled: true,
      minimumPriority: 'HIGH',
      onlyRequiresAction: false,
      quietHoursStart: null,
      quietHoursEnd: null,
      timezone: 'America/Lima',
    }, {
      priority: 'CRITICAL',
      requiresAction: false,
      occurredAt: new Date('2026-08-27T02:00:00Z'),
    })).toEqual({ queue: true, reason: 'ENABLED' });
  });

  it('suppresses notifications below the selected threshold', () => {
    expect(externalDeliveryDecisionV1({
      channel: 'TEAMS_ACTIVITY',
      enabled: true,
      minimumPriority: 'CRITICAL',
      onlyRequiresAction: false,
      quietHoursStart: null,
      quietHoursEnd: null,
      timezone: 'UTC',
    }, {
      priority: 'HIGH',
      requiresAction: true,
      occurredAt: new Date(),
    })).toEqual({ queue: false, reason: 'BELOW_PRIORITY' });
  });

  it('supports channels restricted to items that require action', () => {
    expect(externalDeliveryDecisionV1({
      channel: 'TEAMS_ACTIVITY',
      enabled: true,
      minimumPriority: 'LOW',
      onlyRequiresAction: true,
      quietHoursStart: null,
      quietHoursEnd: null,
      timezone: 'UTC',
    }, {
      priority: 'CRITICAL',
      requiresAction: false,
      occurredAt: new Date(),
    })).toEqual({ queue: false, reason: 'ACTION_ONLY' });
  });

  it('suppresses external delivery during quiet hours that cross midnight', () => {
    expect(externalDeliveryDecisionV1({
      channel: 'OUTLOOK_EMAIL',
      enabled: true,
      minimumPriority: 'LOW',
      onlyRequiresAction: false,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      timezone: 'UTC',
    }, {
      priority: 'HIGH',
      requiresAction: true,
      occurredAt: new Date('2026-08-27T23:30:00Z'),
    })).toEqual({ queue: false, reason: 'QUIET_HOURS' });
  });
});
