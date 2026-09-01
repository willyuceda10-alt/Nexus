import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  automaticRiskNotificationIdempotencyKeyV1g13,
  buildProjectRiskAutomaticNotificationPolicyV1g13,
  type ProjectRiskPolicyAssessmentV1g13,
  type ProjectRiskPolicyNotificationV1g13,
} from './project-risk-notification-policy-v1g13.js';

const now =
  new Date(
    '2026-09-01T12:00:00.000Z',
  );

const highAssessment:
  ProjectRiskPolicyAssessmentV1g13 = {
    id:
      '10000000-0000-4000-8000-000000000001',

    riskLevel:
      'HIGH',

    drivers:
      ['COST_OVERRUN'],

    observedAt:
      new Date(
        '2026-09-01T10:00:00.000Z',
      ),
  };

const watchAssessment:
  ProjectRiskPolicyAssessmentV1g13 = {
    ...highAssessment,

    id:
      '10000000-0000-4000-8000-000000000002',

    riskLevel:
      'WATCH',
  };

function notification(
  overrides:
    Partial<
      ProjectRiskPolicyNotificationV1g13
    > = {},
):
ProjectRiskPolicyNotificationV1g13 {
  return {
    id:
      '20000000-0000-4000-8000-000000000001',

    riskLevel:
      'HIGH',

    drivers:
      ['COST_OVERRUN'],

    fingerprint:
      'previous-fingerprint',

    notifiedAt:
      new Date(
        '2026-09-01T08:00:00.000Z',
      ),

    ...overrides,
  };
}

describe(
  'G13 automatic notification policy',
  () => {
    it(
      'does not notify below HIGH',
      () => {
        const result =
          buildProjectRiskAutomaticNotificationPolicyV1g13({
            current: {
              riskLevel:
                'WATCH',

              drivers:
                ['COST_OVERRUN'],

              fingerprint:
                'watch',
            },

            previousAssessment:
              highAssessment,

            lastNotification:
              notification(),

            now,
          });

        expect(
          result.shouldNotify,
        ).toBe(false);

        expect(
          result.reason,
        ).toBe(
          'NO_ACTION_REQUIRED',
        );
      },
    );

    it(
      'notifies first HIGH risk',
      () => {
        const result =
          buildProjectRiskAutomaticNotificationPolicyV1g13({
            current: {
              riskLevel:
                'HIGH',

              drivers:
                ['COST_OVERRUN'],

              fingerprint:
                'first-high',
            },

            previousAssessment:
              null,

            lastNotification:
              null,

            now,
          });

        expect(
          result.shouldNotify,
        ).toBe(true);

        expect(
          result.reason,
        ).toBe(
          'FIRST_HIGH_RISK',
        );
      },
    );

    it(
      'rearms after recovery',
      () => {
        const result =
          buildProjectRiskAutomaticNotificationPolicyV1g13({
            current: {
              riskLevel:
                'HIGH',

              drivers:
                ['COST_OVERRUN'],

              fingerprint:
                'reentry',
            },

            previousAssessment:
              watchAssessment,

            lastNotification:
              notification({
                notifiedAt:
                  new Date(
                    '2026-09-01T11:30:00.000Z',
                  ),
              }),

            now,
          });

        expect(
          result.shouldNotify,
        ).toBe(true);

        expect(
          result.reason,
        ).toBe(
          'ENTERED_HIGH_RISK',
        );

        expect(
          result.keyMode,
        ).toBe('REENTRY');
      },
    );

    it(
      'notifies HIGH to CRITICAL escalation immediately',
      () => {
        const result =
          buildProjectRiskAutomaticNotificationPolicyV1g13({
            current: {
              riskLevel:
                'CRITICAL',

              drivers:
                ['COST_OVERRUN'],

              fingerprint:
                'critical',
            },

            previousAssessment:
              highAssessment,

            lastNotification:
              notification(),

            now,
          });

        expect(
          result.shouldNotify,
        ).toBe(true);

        expect(
          result.reason,
        ).toBe('ESCALATED');
      },
    );

    it(
      'notifies meaningful driver change',
      () => {
        const result =
          buildProjectRiskAutomaticNotificationPolicyV1g13({
            current: {
              riskLevel:
                'HIGH',

              drivers: [
                'COST_OVERRUN',
                'SCHEDULE_DELAY',
              ],

              fingerprint:
                'new-driver',
            },

            previousAssessment:
              highAssessment,

            lastNotification:
              notification(),

            now,
          });

        expect(
          result.shouldNotify,
        ).toBe(true);

        expect(
          result.reason,
        ).toBe(
          'DRIVERS_CHANGED',
        );
      },
    );

    it(
      'suppresses repeated HIGH risk during cooldown',
      () => {
        const result =
          buildProjectRiskAutomaticNotificationPolicyV1g13({
            current: {
              riskLevel:
                'HIGH',

              drivers:
                ['COST_OVERRUN'],

              fingerprint:
                'changed-numbers',
            },

            previousAssessment:
              highAssessment,

            lastNotification:
              notification({
                notifiedAt:
                  new Date(
                    '2026-09-01T11:00:00.000Z',
                  ),
              }),

            now,
          });

        expect(
          result.shouldNotify,
        ).toBe(false);

        expect(
          result.reason,
        ).toBe(
          'COOLDOWN_ACTIVE',
        );
      },
    );

    it(
      'renotifies CRITICAL after six hour cooldown',
      () => {
        const result =
          buildProjectRiskAutomaticNotificationPolicyV1g13({
            current: {
              riskLevel:
                'CRITICAL',

              drivers:
                ['COST_OVERRUN'],

              fingerprint:
                'still-critical',
            },

            previousAssessment: {
              ...highAssessment,

              riskLevel:
                'CRITICAL',
            },

            lastNotification:
              notification({
                riskLevel:
                  'CRITICAL',

                notifiedAt:
                  new Date(
                    '2026-09-01T05:00:00.000Z',
                  ),
              }),

            now,
          });

        expect(
          result.shouldNotify,
        ).toBe(true);

        expect(
          result.reason,
        ).toBe(
          'COOLDOWN_EXPIRED',
        );

        expect(
          result.cooldownHours,
        ).toBe(6);
      },
    );

    it(
      'creates new key for reentry and cooldown reminder',
      () => {
        const reentry =
          automaticRiskNotificationIdempotencyKeyV1g13({
            baseKey:
              'base',

            decision: {
              keyMode:
                'REENTRY',

              triggerId:
                watchAssessment.id,
            },
          });

        const cooldown =
          automaticRiskNotificationIdempotencyKeyV1g13({
            baseKey:
              'base',

            decision: {
              keyMode:
                'COOLDOWN',

              triggerId:
                notification().id,
            },
          });

        expect(reentry)
          .toContain(':g13:reentry:');

        expect(cooldown)
          .toContain(':g13:cooldown:');
      },
    );
    it(
      'G14 suppresses HIGH when user minimum is CRITICAL',
      () => {
        const result =
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

            minimumRiskLevel:
              'CRITICAL',

            now,
          });

        expect(
          result.shouldNotify,
        ).toBe(false);

        expect(
          result.reason,
        ).toBe(
          'BELOW_USER_THRESHOLD',
        );
      },
    );

    it(
      'G14 can disable automatic risk notifications',
      () => {
        const result =
          buildProjectRiskAutomaticNotificationPolicyV1g13({
            current: {
              riskLevel:
                'CRITICAL',

              drivers:
                ['COST_OVERRUN'],

              fingerprint:
                'g14-disabled',
            },

            previousAssessment:
              null,

            lastNotification:
              null,

            enabled:
              false,

            now,
          });

        expect(
          result.shouldNotify,
        ).toBe(false);

        expect(
          result.reason,
        ).toBe(
          'USER_DISABLED',
        );
      },
    );

    it(
      'G14 uses custom critical cooldown',
      () => {
        const result =
          buildProjectRiskAutomaticNotificationPolicyV1g13({
            current: {
              riskLevel:
                'CRITICAL',

              drivers:
                ['COST_OVERRUN'],

              fingerprint:
                'g14-critical',
            },

            previousAssessment: {
              ...highAssessment,

              riskLevel:
                'CRITICAL',
            },

            lastNotification:
              notification({
                riskLevel:
                  'CRITICAL',

                notifiedAt:
                  new Date(
                    '2026-09-01T04:00:00.000Z',
                  ),
              }),

            criticalCooldownHours:
              12,

            now,
          });

        expect(
          result.shouldNotify,
        ).toBe(false);

        expect(
          result.reason,
        ).toBe(
          'COOLDOWN_ACTIVE',
        );

        expect(
          result.cooldownHours,
        ).toBe(12);
      },
    );

    it(
      'G14 can disable driver-change notifications',
      () => {
        const result =
          buildProjectRiskAutomaticNotificationPolicyV1g13({
            current: {
              riskLevel:
                'HIGH',

              drivers: [
                'COST_OVERRUN',
                'SCHEDULE_DELAY',
              ],

              fingerprint:
                'g14-driver',
            },

            previousAssessment:
              highAssessment,

            lastNotification:
              notification(),

            notifyOnDriverChange:
              false,

            now,
          });

        expect(
          result.shouldNotify,
        ).toBe(false);

        expect(
          result.reason,
        ).toBe(
          'DRIVER_CHANGE_DISABLED',
        );
      },
    );


  },
);
