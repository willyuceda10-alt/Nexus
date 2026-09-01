import { z } from 'zod';

import type {
  ProjectRiskDriverV1g7,
  ProjectRiskLevelV1g7,
} from './project-risk-forecast-v1g7.js';

export type ProjectRiskAutoNotificationReasonV1g13 =
  | 'NO_ACTION_REQUIRED'
  | 'FIRST_HIGH_RISK'
  | 'ENTERED_HIGH_RISK'
  | 'ESCALATED'
  | 'DRIVERS_CHANGED'
  | 'COOLDOWN_EXPIRED'
  | 'COOLDOWN_ACTIVE'
  | 'USER_DISABLED'
  | 'BELOW_USER_THRESHOLD'
  | 'REENTRY_DISABLED'
  | 'ESCALATION_DISABLED'
  | 'DRIVER_CHANGE_DISABLED'
  | 'COOLDOWN_REMINDER_DISABLED';

export type ProjectRiskNotificationKeyModeV1g13 =
  | 'BASE'
  | 'REENTRY'
  | 'COOLDOWN';

export interface ProjectRiskPolicyAssessmentV1g13 {
  id: string;

  riskLevel:
    ProjectRiskLevelV1g7;

  drivers:
    ProjectRiskDriverV1g7[];

  observedAt: Date;
}

export interface ProjectRiskPolicyNotificationV1g13 {
  id: string;

  riskLevel:
    ProjectRiskLevelV1g7;

  drivers:
    ProjectRiskDriverV1g7[];

  fingerprint: string;

  notifiedAt: Date;
}

const severity:
  Record<ProjectRiskLevelV1g7, number> = {
    INSUFFICIENT_DATA: -1,
    ON_TRACK: 0,
    WATCH: 1,
    HIGH: 2,
    CRITICAL: 3,
  };

const notificationReasonSchema =
  z.enum([
    'NO_ACTION_REQUIRED',
    'FIRST_HIGH_RISK',
    'ENTERED_HIGH_RISK',
    'ESCALATED',
    'DRIVERS_CHANGED',
    'COOLDOWN_EXPIRED',
    'COOLDOWN_ACTIVE',
    'USER_DISABLED',
    'BELOW_USER_THRESHOLD',
    'REENTRY_DISABLED',
    'ESCALATION_DISABLED',
    'DRIVER_CHANGE_DISABLED',
    'COOLDOWN_REMINDER_DISABLED',
  ]);

export const projectRiskAutomaticNotificationDetailsSchemaV1g13 =
  z.object({
    version:
      z.literal('v1g13'),

    targetUserId:
      z.string().uuid(),

    riskLevel:
      z.enum([
        'INSUFFICIENT_DATA',
        'ON_TRACK',
        'WATCH',
        'HIGH',
        'CRITICAL',
      ]),

    drivers:
      z.array(
        z.enum([
          'COST_OVERRUN',
          'SCHEDULE_DELAY',
          'LOW_SCHEDULE_CONFIDENCE',
          'NO_CONTROL_BUDGET',
        ]),
      ),

    fingerprint:
      z.string().min(1),

    reason:
      notificationReasonSchema,

    cooldownHours:
      z.number()
        .int()
        .positive(),

    notificationEventId:
      z.string().uuid(),

    notificationCreated:
      z.boolean(),
  });

function isActionableRisk(
  riskLevel:
    ProjectRiskLevelV1g7,
): boolean {
  return (
    riskLevel === 'HIGH' ||
    riskLevel === 'CRITICAL'
  );
}

function sameDrivers(
  left:
    ProjectRiskDriverV1g7[],
  right:
    ProjectRiskDriverV1g7[],
): boolean {
  const a =
    [...new Set(left)]
      .sort();

  const b =
    [...new Set(right)]
      .sort();

  return (
    a.length === b.length &&
    a.every(
      (value, index) =>
        value === b[index],
    )
  );
}

export function buildProjectRiskAutomaticNotificationPolicyV1g13(
  input: {
    current: {
      riskLevel:
        ProjectRiskLevelV1g7;

      drivers:
        ProjectRiskDriverV1g7[];

      fingerprint: string;
    };

    previousAssessment:
      ProjectRiskPolicyAssessmentV1g13 |
      null;

    lastNotification:
      ProjectRiskPolicyNotificationV1g13 |
      null;

    now?: Date;

    enabled?: boolean;

    minimumRiskLevel?:
      'HIGH' |
      'CRITICAL';

    highCooldownHours?: number;
    criticalCooldownHours?: number;

    notifyOnEscalation?: boolean;
    notifyOnDriverChange?: boolean;
    notifyOnReentry?: boolean;
    notifyOnCooldownReminder?: boolean;
  },
) {
  const now =
    input.now ??
    new Date();

  const enabled =
    input.enabled ??
    true;

  const minimumRiskLevel =
    input.minimumRiskLevel ??
    'HIGH';

  const notifyOnEscalation =
    input.notifyOnEscalation ??
    true;

  const notifyOnDriverChange =
    input.notifyOnDriverChange ??
    true;

  const notifyOnReentry =
    input.notifyOnReentry ??
    true;

  const notifyOnCooldownReminder =
    input.notifyOnCooldownReminder ??
    true;

  const highCooldownHours =
    input.highCooldownHours ??
    24;

  const criticalCooldownHours =
    input.criticalCooldownHours ??
    6;

  const cooldownHours =
    input.current.riskLevel ===
    'CRITICAL'
      ? criticalCooldownHours
      : highCooldownHours;

  const result = (
    shouldNotify: boolean,
    reason:
      ProjectRiskAutoNotificationReasonV1g13,
    keyMode:
      ProjectRiskNotificationKeyModeV1g13,
    triggerId:
      string | null,
    cooldownRemainingMinutes = 0,
  ) => ({
    version:
      'v1g13' as const,

    shouldNotify,
    reason,
    keyMode,
    triggerId,

    cooldownHours,

    cooldownRemainingMinutes:
      Math.max(
        cooldownRemainingMinutes,
        0,
      ),
  });

  if (
    !isActionableRisk(
      input.current.riskLevel,
    )
  ) {
    return result(
      false,
      'NO_ACTION_REQUIRED',
      'BASE',
      null,
    );
  }

  if (!enabled) {
    return result(
      false,
      'USER_DISABLED',
      'BASE',
      null,
    );
  }

  if (
    severity[
      input.current.riskLevel
    ] <
    severity[
      minimumRiskLevel
    ]
  ) {
    return result(
      false,
      'BELOW_USER_THRESHOLD',
      'BASE',
      null,
    );
  }

  if (
    input.previousAssessment &&
    severity[
      input.previousAssessment
        .riskLevel
    ] <
      severity.HIGH
  ) {
    if (!notifyOnReentry) {
      return result(
        false,
        'REENTRY_DISABLED',
        'BASE',
        null,
      );
    }

    return result(
      true,
      'ENTERED_HIGH_RISK',
      'REENTRY',
      input.previousAssessment.id,
    );
  }

  if (!input.lastNotification) {
    return result(
      true,
      'FIRST_HIGH_RISK',
      'BASE',
      null,
    );
  }

  if (
    severity[
      input.current.riskLevel
    ] >
    severity[
      input.lastNotification
        .riskLevel
    ]
  ) {
    if (!notifyOnEscalation) {
      return result(
        false,
        'ESCALATION_DISABLED',
        'BASE',
        null,
      );
    }

    return result(
      true,
      'ESCALATED',
      'BASE',
      null,
    );
  }

  if (
    !sameDrivers(
      input.current.drivers,
      input.lastNotification
        .drivers,
    )
  ) {
    if (!notifyOnDriverChange) {
      return result(
        false,
        'DRIVER_CHANGE_DISABLED',
        'BASE',
        null,
      );
    }

    return result(
      true,
      'DRIVERS_CHANGED',
      'BASE',
      null,
    );
  }

  const cooldownMs =
    cooldownHours *
    60 *
    60 *
    1000;

  const elapsedMs =
    Math.max(
      now.getTime() -
      input.lastNotification
        .notifiedAt
        .getTime(),
      0,
    );

  if (
    elapsedMs >=
    cooldownMs
  ) {
    if (!notifyOnCooldownReminder) {
      return result(
        false,
        'COOLDOWN_REMINDER_DISABLED',
        'BASE',
        null,
      );
    }

    return result(
      true,
      'COOLDOWN_EXPIRED',
      'COOLDOWN',
      input.lastNotification.id,
    );
  }

  const remainingMinutes =
    Math.ceil(
      (
        cooldownMs -
        elapsedMs
      ) /
      60000,
    );

  return result(
    false,
    'COOLDOWN_ACTIVE',
    'BASE',
    null,
    remainingMinutes,
  );
}

export function automaticRiskNotificationIdempotencyKeyV1g13(
  input: {
    baseKey: string;

    decision: {
      keyMode:
        ProjectRiskNotificationKeyModeV1g13;

      triggerId:
        string | null;
    };
  },
): string {
  if (
    input.decision.keyMode ===
      'BASE' ||
    !input.decision.triggerId
  ) {
    return input.baseKey;
  }

  const suffix =
    input.decision.keyMode ===
    'REENTRY'
      ? 'reentry'
      : 'cooldown';

  return [
    input.baseKey,
    'g13',
    suffix,
    input.decision.triggerId,
  ].join(':');
}
