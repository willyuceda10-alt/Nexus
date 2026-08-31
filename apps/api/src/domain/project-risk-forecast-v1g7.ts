import type { CostHealthV2 } from './cost-engine-v2.js';

export type ProjectRiskLevelV1g7 =
  | 'INSUFFICIENT_DATA'
  | 'ON_TRACK'
  | 'WATCH'
  | 'HIGH'
  | 'CRITICAL';

export type ScheduleRiskLevelV1g7 =
  | 'ON_TRACK'
  | 'WATCH'
  | 'HIGH'
  | 'CRITICAL';

export type ProjectRiskDriverV1g7 =
  | 'COST_OVERRUN'
  | 'SCHEDULE_DELAY'
  | 'LOW_SCHEDULE_CONFIDENCE'
  | 'NO_CONTROL_BUDGET';

export interface ProjectRiskForecastInputV1g7 {
  financial: {
    health: CostHealthV2;
    controlBudget: number;
    estimateAtCompletion: number;
    varianceAtCompletion: number;
    forecastVariancePercent: number | null;
  };
  schedule: {
    plannedFinish: string | null;
    forecastFinish: string | null;
    forecastVarianceDays: number | null;
    projectedTaskCount: number;
    lowConfidenceTaskCount: number;
  };
}

const severity: Record<
  Exclude<ProjectRiskLevelV1g7, 'INSUFFICIENT_DATA'>,
  number
> = {
  ON_TRACK: 0,
  WATCH: 1,
  HIGH: 2,
  CRITICAL: 3,
};

function scheduleRisk(
  varianceDays: number | null,
): ScheduleRiskLevelV1g7 | null {
  if (varianceDays == null) return null;
  if (varianceDays <= 0) return 'ON_TRACK';
  if (varianceDays <= 5) return 'WATCH';
  if (varianceDays <= 15) return 'HIGH';
  return 'CRITICAL';
}

function overallRisk(
  costHealth: CostHealthV2,
  schedule: ScheduleRiskLevelV1g7 | null,
): ProjectRiskLevelV1g7 {
  const cost =
    costHealth === 'NO_BUDGET'
      ? null
      : costHealth;

  if (!cost && !schedule) return 'INSUFFICIENT_DATA';
  if (!cost) return schedule!;
  if (!schedule) return cost;

  return severity[cost] >= severity[schedule]
    ? cost
    : schedule;
}

export function buildProjectRiskForecastV1g7(
  input: ProjectRiskForecastInputV1g7,
) {
  const scheduleHealth = scheduleRisk(
    input.schedule.forecastVarianceDays,
  );

  const riskLevel = overallRisk(
    input.financial.health,
    scheduleHealth,
  );

  const drivers: ProjectRiskDriverV1g7[] = [];

  if (
    input.financial.health !== 'NO_BUDGET' &&
    input.financial.health !== 'ON_TRACK'
  ) {
    drivers.push('COST_OVERRUN');
  }

  if (
    scheduleHealth &&
    scheduleHealth !== 'ON_TRACK'
  ) {
    drivers.push('SCHEDULE_DELAY');
  }

  if (
    input.schedule.projectedTaskCount > 0 &&
    input.schedule.lowConfidenceTaskCount > 0
  ) {
    drivers.push('LOW_SCHEDULE_CONFIDENCE');
  }

  if (input.financial.health === 'NO_BUDGET') {
    drivers.push('NO_CONTROL_BUDGET');
  }

  return {
    version: 'v1g7' as const,
    riskLevel,
    drivers,

    financial: {
      health: input.financial.health,
      controlBudget: input.financial.controlBudget,
      estimateAtCompletion:
        input.financial.estimateAtCompletion,
      varianceAtCompletion:
        input.financial.varianceAtCompletion,
      forecastVariancePercent:
        input.financial.forecastVariancePercent,
    },

    schedule: {
      health: scheduleHealth,
      plannedFinish: input.schedule.plannedFinish,
      forecastFinish: input.schedule.forecastFinish,
      forecastVarianceDays:
        input.schedule.forecastVarianceDays,
      projectedTaskCount:
        input.schedule.projectedTaskCount,
      lowConfidenceTaskCount:
        input.schedule.lowConfidenceTaskCount,
    },

    hasCostRisk:
      input.financial.health !== 'NO_BUDGET' &&
      input.financial.health !== 'ON_TRACK',

    hasScheduleRisk:
      scheduleHealth !== null &&
      scheduleHealth !== 'ON_TRACK',

    requiresAttention:
      riskLevel === 'WATCH' ||
      riskLevel === 'HIGH' ||
      riskLevel === 'CRITICAL',
  };
}
