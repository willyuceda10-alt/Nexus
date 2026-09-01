import type { CostHealthV2 } from './cost-engine-v2.js';

import type {
  ProjectRiskDriverV1g7,
  ProjectRiskLevelV1g7,
  ScheduleRiskLevelV1g7,
} from './project-risk-forecast-v1g7.js';

export type ProjectRiskTrendV1g10 =
  | 'INSUFFICIENT_DATA'
  | 'IMPROVING'
  | 'STABLE'
  | 'WORSENING';

export interface ProjectRiskHistoryPointV1g10 {
  id: string;
  observedAt: string;

  riskLevel: ProjectRiskLevelV1g7;
  drivers: ProjectRiskDriverV1g7[];

  financialHealth: CostHealthV2;
  scheduleHealth: ScheduleRiskLevelV1g7 | null;

  forecastVariancePercent: number | null;
  forecastVarianceDays: number | null;

  requiresAttention: boolean;
  fingerprint: string;
}

const severity:
  Record<ProjectRiskLevelV1g7, number> = {
    INSUFFICIENT_DATA: -1,
    ON_TRACK: 0,
    WATCH: 1,
    HIGH: 2,
    CRITICAL: 3,
  };

function classifyTrend(
  previous: ProjectRiskLevelV1g7,
  current: ProjectRiskLevelV1g7,
): Exclude<
  ProjectRiskTrendV1g10,
  'INSUFFICIENT_DATA'
> {
  const before = severity[previous];
  const after = severity[current];

  if (after > before) {
    return 'WORSENING';
  }

  if (after < before) {
    return 'IMPROVING';
  }

  return 'STABLE';
}

export function buildProjectRiskHistoryV1g10(
  input: ProjectRiskHistoryPointV1g10[],
) {
  const chronological =
    [...input].sort(
      (a, b) =>
        new Date(a.observedAt).getTime() -
        new Date(b.observedAt).getTime(),
    );

  const latest =
    chronological.at(-1) ?? null;

  const previous =
    chronological.at(-2) ?? null;

  const first =
    chronological.at(0) ?? null;

  const currentTrend:
    ProjectRiskTrendV1g10 =
    latest && previous
      ? classifyTrend(
          previous.riskLevel,
          latest.riskLevel,
        )
      : 'INSUFFICIENT_DATA';

  const netTrend:
    ProjectRiskTrendV1g10 =
    latest &&
    first &&
    latest.id !== first.id
      ? classifyTrend(
          first.riskLevel,
          latest.riskLevel,
        )
      : 'INSUFFICIENT_DATA';

  let worsened = 0;
  let improved = 0;
  let stable = 0;

  for (
    let index = 1;
    index < chronological.length;
    index += 1
  ) {
    const before =
      chronological[index - 1]!;

    const after =
      chronological[index]!;

    const direction =
      classifyTrend(
        before.riskLevel,
        after.riskLevel,
      );

    if (direction === 'WORSENING') {
      worsened += 1;
    } else if (
      direction === 'IMPROVING'
    ) {
      improved += 1;
    } else {
      stable += 1;
    }
  }

  let currentStreakCount = 0;

  if (latest) {
    for (
      let index =
        chronological.length - 1;
      index >= 0;
      index -= 1
    ) {
      if (
        chronological[index]!
          .riskLevel !==
        latest.riskLevel
      ) {
        break;
      }

      currentStreakCount += 1;
    }
  }

  let maxRiskEver:
    ProjectRiskLevelV1g7 | null =
    null;

  for (const point of chronological) {
    if (
      maxRiskEver === null ||
      severity[point.riskLevel] >
        severity[maxRiskEver]
    ) {
      maxRiskEver =
        point.riskLevel;
    }
  }

  return {
    version: 'v1g10' as const,

    observationCount:
      chronological.length,

    currentRisk:
      latest?.riskLevel ?? null,

    previousRisk:
      previous?.riskLevel ?? null,

    maxRiskEver,

    trend: {
      current: currentTrend,
      net: netTrend,

      worsenedTransitions:
        worsened,

      improvedTransitions:
        improved,

      stableTransitions:
        stable,

      currentStreakCount,
    },

    firstObservedAt:
      first?.observedAt ?? null,

    lastObservedAt:
      latest?.observedAt ?? null,

    timeline:
      [...chronological].reverse(),
  };
}
