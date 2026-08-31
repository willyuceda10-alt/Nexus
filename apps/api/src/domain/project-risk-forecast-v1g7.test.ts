import { describe, expect, it } from 'vitest';
import { buildProjectRiskForecastV1g7 } from './project-risk-forecast-v1g7.js';

describe('buildProjectRiskForecastV1g7', () => {
  it('uses the highest risk between cost and schedule', () => {
    const result = buildProjectRiskForecastV1g7({
      financial: {
        health: 'HIGH',
        controlBudget: 350,
        estimateAtCompletion: 370,
        varianceAtCompletion: -20,
        forecastVariancePercent: 5.7143,
      },
      schedule: {
        plannedFinish: '2026-09-10',
        forecastFinish: '2026-09-17',
        forecastVarianceDays: 7,
        projectedTaskCount: 4,
        lowConfidenceTaskCount: 1,
      },
    });

    expect(result.riskLevel).toBe('HIGH');
    expect(result.financial.health).toBe('HIGH');
    expect(result.schedule.health).toBe('HIGH');
    expect(result.drivers).toContain('COST_OVERRUN');
    expect(result.drivers).toContain('SCHEDULE_DELAY');
    expect(result.requiresAttention).toBe(true);
  });

  it('promotes a critical schedule delay above healthy cost', () => {
    const result = buildProjectRiskForecastV1g7({
      financial: {
        health: 'ON_TRACK',
        controlBudget: 500,
        estimateAtCompletion: 450,
        varianceAtCompletion: 50,
        forecastVariancePercent: -10,
      },
      schedule: {
        plannedFinish: '2026-09-01',
        forecastFinish: '2026-09-25',
        forecastVarianceDays: 20,
        projectedTaskCount: 5,
        lowConfidenceTaskCount: 0,
      },
    });

    expect(result.riskLevel).toBe('CRITICAL');
    expect(result.schedule.health).toBe('CRITICAL');
    expect(result.hasCostRisk).toBe(false);
    expect(result.hasScheduleRisk).toBe(true);
  });

  it('returns insufficient data when there is no budget or schedule forecast', () => {
    const result = buildProjectRiskForecastV1g7({
      financial: {
        health: 'NO_BUDGET',
        controlBudget: 0,
        estimateAtCompletion: 0,
        varianceAtCompletion: 0,
        forecastVariancePercent: null,
      },
      schedule: {
        plannedFinish: null,
        forecastFinish: null,
        forecastVarianceDays: null,
        projectedTaskCount: 0,
        lowConfidenceTaskCount: 0,
      },
    });

    expect(result.riskLevel).toBe('INSUFFICIENT_DATA');
    expect(result.schedule.health).toBeNull();
    expect(result.drivers).toContain('NO_CONTROL_BUDGET');
    expect(result.requiresAttention).toBe(false);
  });

  it('keeps watch cost risk when schedule is on time', () => {
    const result = buildProjectRiskForecastV1g7({
      financial: {
        health: 'WATCH',
        controlBudget: 100,
        estimateAtCompletion: 103,
        varianceAtCompletion: -3,
        forecastVariancePercent: 3,
      },
      schedule: {
        plannedFinish: '2026-09-10',
        forecastFinish: '2026-09-10',
        forecastVarianceDays: 0,
        projectedTaskCount: 2,
        lowConfidenceTaskCount: 0,
      },
    });

    expect(result.riskLevel).toBe('WATCH');
    expect(result.schedule.health).toBe('ON_TRACK');
    expect(result.hasCostRisk).toBe(true);
    expect(result.hasScheduleRisk).toBe(false);
  });
});
