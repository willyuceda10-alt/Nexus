import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  defaultProjectRiskNotificationPreferencesV1g14,
  serializeProjectRiskNotificationPreferencesV1g14,
} from './project-risk-notification-preferences-v1g14.js';

describe(
  'G14 project risk notification preferences',
  () => {
    it(
      'preserves G13 defaults',
      () => {
        const value =
          defaultProjectRiskNotificationPreferencesV1g14();

        expect(value.enabled)
          .toBe(true);

        expect(
          value.minimumRiskLevel,
        ).toBe('HIGH');

        expect(
          value.highCooldownHours,
        ).toBe(24);

        expect(
          value.criticalCooldownHours,
        ).toBe(6);

        expect(
          value.notifyOnEscalation,
        ).toBe(true);

        expect(
          value.notifyOnDriverChange,
        ).toBe(true);

        expect(
          value.notifyOnReentry,
        ).toBe(true);

        expect(
          value.notifyOnCooldownReminder,
        ).toBe(true);
      },
    );

    it(
      'serializes persisted user configuration',
      () => {
        const value =
          serializeProjectRiskNotificationPreferencesV1g14({
            enabled:
              true,

            minimum_risk_level:
              'CRITICAL',

            high_cooldown_hours:
              48,

            critical_cooldown_hours:
              12,

            notify_on_escalation:
              true,

            notify_on_driver_change:
              false,

            notify_on_reentry:
              false,

            notify_on_cooldown_reminder:
              false,
          });

        expect(
          value.minimumRiskLevel,
        ).toBe('CRITICAL');

        expect(
          value.highCooldownHours,
        ).toBe(48);

        expect(
          value.criticalCooldownHours,
        ).toBe(12);

        expect(
          value.notifyOnDriverChange,
        ).toBe(false);

        expect(
          value.notifyOnReentry,
        ).toBe(false);
      },
    );
  },
);
