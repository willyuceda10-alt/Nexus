import type {
  ProjectRiskLevelV1g7,
} from './project-risk-forecast-v1g7.js';

import type {
  ProjectRiskTrendV1g10,
} from './project-risk-history-v1g10.js';

export type HierarchyRiskScopeV1g11 =
  | 'PROGRAM'
  | 'PORTFOLIO';

export interface HierarchyRiskProjectV1g11 {
  projectId: string;
  title: string;

  currentRisk:
    | ProjectRiskLevelV1g7
    | null;

  trend:
    ProjectRiskTrendV1g10;

  requiresAttention: boolean;

  lastObservedAt:
    string | null;

  hasRiskData: boolean;
}

const riskSeverity:
  Record<ProjectRiskLevelV1g7, number> = {
    INSUFFICIENT_DATA: -1,
    ON_TRACK: 0,
    WATCH: 1,
    HIGH: 2,
    CRITICAL: 3,
  };

const trendPriority:
  Record<ProjectRiskTrendV1g10, number> = {
    INSUFFICIENT_DATA: 0,
    IMPROVING: 1,
    STABLE: 2,
    WORSENING: 3,
  };

function percentage(
  numerator: number,
  denominator: number,
): number {
  if (denominator <= 0) {
    return 0;
  }

  return Math.round(
    (
      numerator /
      denominator
    ) *
    10000,
  ) / 100;
}

function normalizedRisk(
  risk:
    | ProjectRiskLevelV1g7
    | null,
): ProjectRiskLevelV1g7 {
  return risk ??
    'INSUFFICIENT_DATA';
}

export function
buildHierarchyRiskAggregationV1g11(
  input: {
    scopeType:
      HierarchyRiskScopeV1g11;

    projects:
      HierarchyRiskProjectV1g11[];
  },
) {
  const riskCounts = {
    INSUFFICIENT_DATA: 0,
    ON_TRACK: 0,
    WATCH: 0,
    HIGH: 0,
    CRITICAL: 0,
  };

  const trendCounts = {
    INSUFFICIENT_DATA: 0,
    IMPROVING: 0,
    STABLE: 0,
    WORSENING: 0,
  };

  let aggregateRisk:
    ProjectRiskLevelV1g7 =
    'INSUFFICIENT_DATA';

  let requiresAttentionCount = 0;

  for (const project of input.projects) {
    const risk =
      normalizedRisk(
        project.currentRisk,
      );

    riskCounts[risk] += 1;
    trendCounts[project.trend] += 1;

    if (project.requiresAttention) {
      requiresAttentionCount += 1;
    }

    if (
      riskSeverity[risk] >
      riskSeverity[aggregateRisk]
    ) {
      aggregateRisk = risk;
    }
  }

  const projectsWithRiskData =
    input.projects.filter(
      (project) =>
        project.hasRiskData &&
        project.currentRisk !==
          'INSUFFICIENT_DATA',
    ).length;

  const projectsWithoutRiskData =
    input.projects.length -
    projectsWithRiskData;

  const highCriticalProjects =
    riskCounts.HIGH +
    riskCounts.CRITICAL;

  const comparableTrendProjects =
    trendCounts.IMPROVING +
    trendCounts.STABLE +
    trendCounts.WORSENING;

  let aggregateTrend:
    ProjectRiskTrendV1g10 =
    'INSUFFICIENT_DATA';

  if (comparableTrendProjects > 0) {
    if (
      trendCounts.WORSENING >
      trendCounts.IMPROVING
    ) {
      aggregateTrend =
        'WORSENING';
    } else if (
      trendCounts.IMPROVING >
      trendCounts.WORSENING
    ) {
      aggregateTrend =
        'IMPROVING';
    } else {
      aggregateTrend =
        'STABLE';
    }
  }

  const orderedProjects =
    [...input.projects].sort(
      (a, b) => {
        const riskDelta =
          riskSeverity[
            normalizedRisk(
              b.currentRisk,
            )
          ] -
          riskSeverity[
            normalizedRisk(
              a.currentRisk,
            )
          ];

        if (riskDelta !== 0) {
          return riskDelta;
        }

        const trendDelta =
          trendPriority[b.trend] -
          trendPriority[a.trend];

        if (trendDelta !== 0) {
          return trendDelta;
        }

        return a.title.localeCompare(
          b.title,
        );
      },
    );

  return {
    version:
      'v1g11' as const,

    scopeType:
      input.scopeType,

    aggregateRisk,
    aggregateTrend,

    totalProjects:
      input.projects.length,

    projectsWithRiskData,
    projectsWithoutRiskData,

    highCriticalProjects,

    requiresAttentionCount,

    coveragePercent:
      percentage(
        projectsWithRiskData,
        input.projects.length,
      ),

    highCriticalPercent:
      percentage(
        highCriticalProjects,
        projectsWithRiskData,
      ),

    requiresAttentionPercent:
      percentage(
        requiresAttentionCount,
        input.projects.length,
      ),

    riskCounts,
    trendCounts,

    topRiskProjects:
      orderedProjects.slice(
        0,
        10,
      ),

    projects:
      orderedProjects,
  };
}
