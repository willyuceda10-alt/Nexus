import { describe, expect, it } from 'vitest';
import {
  buildProjectRiskAlertV1g8,
  projectRiskFingerprintV1g8,
  type ProjectRiskAlertInputV1g8,
} from './project-risk-alert-v1g8.js';

const base: ProjectRiskAlertInputV1g8 = {
  tenantId: '00000000-0000-4000-8000-000000000002',
  projectId: '10000000-0000-4000-8000-000000000001',
  projectTitle: 'Proyecto Norte',
  workspaceId: '00000000-0000-4000-8000-000000000003',
  targetUserId: '00000000-0000-4000-8000-000000000001',

  risk: {
    riskLevel: 'CRITICAL',
    drivers: ['COST_OVERRUN', 'SCHEDULE_DELAY'],
    requiresAttention: true,

    financial: {
      health: 'HIGH',
      controlBudget: 350,
      estimateAtCompletion: 370,
      varianceAtCompletion: -20,
      forecastVariancePercent: 5.7143,
    },

    schedule: {
      health: 'CRITICAL',
      plannedFinish: '2026-08-25',
      forecastFinish: '2026-09-20',
      forecastVarianceDays: 20,
    },
  },
};

describe('buildProjectRiskAlertV1g8', () => {
  it('creates a critical actionable notification', () => {
    const result = buildProjectRiskAlertV1g8(base);

    expect(result.version).toBe('v1g8');
    expect(result.shouldNotify).toBe(true);
    expect(result.priority).toBe('CRITICAL');

    expect(result.assessmentEvent.eventType)
      .toBe('bridata.project.risk.assessed');

    expect(result.notificationEvent?.eventType)
      .toBe('bridata.notification.requested');

    expect(result.notificationEvent?.payload.priority)
      .toBe('CRITICAL');

    expect(result.notificationEvent?.payload.requiresAction)
      .toBe(true);

    expect(result.notificationEvent?.payload.scopeProjectId)
      .toBe(base.projectId);
  });

  it('creates a high alert for high project risk', () => {
    const result = buildProjectRiskAlertV1g8({
      ...base,
      risk: {
        ...base.risk,
        riskLevel: 'HIGH',
        schedule: {
          ...base.risk.schedule,
          health: 'HIGH',
          forecastVarianceDays: 10,
        },
      },
    });

    expect(result.shouldNotify).toBe(true);
    expect(result.priority).toBe('HIGH');
  });

  it('does not notify for watch risk', () => {
    const result = buildProjectRiskAlertV1g8({
      ...base,
      risk: {
        ...base.risk,
        riskLevel: 'WATCH',
        drivers: ['COST_OVERRUN'],
        financial: {
          ...base.risk.financial,
          health: 'WATCH',
        },
        schedule: {
          ...base.risk.schedule,
          health: 'ON_TRACK',
          forecastVarianceDays: 0,
        },
      },
    });

    expect(result.shouldNotify).toBe(false);
    expect(result.notificationEvent).toBeNull();

    expect(result.assessmentEvent.eventType)
      .toBe('bridata.project.risk.assessed');
  });

  it('is deterministic for the same risk snapshot', () => {
    const first = buildProjectRiskAlertV1g8(base);
    const second = buildProjectRiskAlertV1g8(base);

    expect(first.fingerprint).toBe(second.fingerprint);

    expect(first.notificationEvent?.idempotencyKey)
      .toBe(second.notificationEvent?.idempotencyKey);

    expect(projectRiskFingerprintV1g8(base))
      .toBe(first.fingerprint);
  });

  it('changes fingerprint when the risk changes', () => {
    const first = projectRiskFingerprintV1g8(base);

    const second = projectRiskFingerprintV1g8({
      ...base,
      risk: {
        ...base.risk,
        financial: {
          ...base.risk.financial,
          estimateAtCompletion: 390,
        },
      },
    });

    expect(first).not.toBe(second);
  });
});
