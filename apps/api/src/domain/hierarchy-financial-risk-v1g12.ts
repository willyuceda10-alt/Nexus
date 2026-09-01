import type {
  ProjectRiskLevelV1g7,
} from './project-risk-forecast-v1g7.js';

export interface FinancialRiskProjectV1g12 {
  projectId: string;
  title: string;

  riskLevel:
    ProjectRiskLevelV1g7;

  currency: string;

  controlBudget: number;
  estimateAtCompletion: number;
  varianceAtCompletion: number;

  financialDataSource:
    | 'RISK_SNAPSHOT'
    | 'LEGACY_RECOMPUTE';
}

const severity:
  Record<ProjectRiskLevelV1g7, number> = {
    INSUFFICIENT_DATA: -1,
    ON_TRACK: 0,
    WATCH: 1,
    HIGH: 2,
    CRITICAL: 3,
  };

function round2(
  value: number,
): number {
  return Math.round(
    value * 100,
  ) / 100;
}

function percent(
  numerator: number,
  denominator: number,
): number {
  if (denominator <= 0) {
    return 0;
  }

  return round2(
    (
      numerator /
      denominator
    ) * 100,
  );
}

export function
buildFinancialRiskExposureV1g12(
  input: {
    currency: string;

    projects:
      FinancialRiskProjectV1g12[];
  },
) {
  let totalControlBudget = 0;
  let totalEstimateAtCompletion = 0;
  let totalProjectedOverrun = 0;

  let riskExposedControlBudget = 0;
  let riskExposedEstimateAtCompletion = 0;
  let riskExposedProjectedOverrun = 0;

  let criticalControlBudget = 0;
  let highControlBudget = 0;

  for (const project of input.projects) {
    totalControlBudget +=
      project.controlBudget;

    totalEstimateAtCompletion +=
      project.estimateAtCompletion;

    const projectedOverrun =
      Math.max(
        project.estimateAtCompletion -
          project.controlBudget,
        0,
      );

    totalProjectedOverrun +=
      projectedOverrun;

    const isAtRisk =
      project.riskLevel === 'HIGH' ||
      project.riskLevel === 'CRITICAL';

    if (isAtRisk) {
      riskExposedControlBudget +=
        project.controlBudget;

      riskExposedEstimateAtCompletion +=
        project.estimateAtCompletion;

      riskExposedProjectedOverrun +=
        projectedOverrun;
    }

    if (
      project.riskLevel === 'CRITICAL'
    ) {
      criticalControlBudget +=
        project.controlBudget;
    }

    if (
      project.riskLevel === 'HIGH'
    ) {
      highControlBudget +=
        project.controlBudget;
    }
  }

  const ordered =
    [...input.projects].sort(
      (a, b) => {
        const aOverrun =
          Math.max(
            a.estimateAtCompletion -
              a.controlBudget,
            0,
          );

        const bOverrun =
          Math.max(
            b.estimateAtCompletion -
              b.controlBudget,
            0,
          );

        if (bOverrun !== aOverrun) {
          return bOverrun - aOverrun;
        }

        const severityDelta =
          severity[b.riskLevel] -
          severity[a.riskLevel];

        if (severityDelta !== 0) {
          return severityDelta;
        }

        return (
          b.controlBudget -
          a.controlBudget
        );
      },
    );

  return {
    version:
      'v1g12' as const,

    currency:
      input.currency,

    projectCount:
      input.projects.length,

    totalControlBudget:
      round2(
        totalControlBudget,
      ),

    totalEstimateAtCompletion:
      round2(
        totalEstimateAtCompletion,
      ),

    totalProjectedOverrun:
      round2(
        totalProjectedOverrun,
      ),

    projectedOverrunPercent:
      percent(
        totalProjectedOverrun,
        totalControlBudget,
      ),

    riskExposedControlBudget:
      round2(
        riskExposedControlBudget,
      ),

    riskExposedEstimateAtCompletion:
      round2(
        riskExposedEstimateAtCompletion,
      ),

    riskExposedProjectedOverrun:
      round2(
        riskExposedProjectedOverrun,
      ),

    riskExposedBudgetPercent:
      percent(
        riskExposedControlBudget,
        totalControlBudget,
      ),

    criticalControlBudget:
      round2(
        criticalControlBudget,
      ),

    highControlBudget:
      round2(
        highControlBudget,
      ),

    topExposureProjects:
      ordered
        .slice(0, 10)
        .map(
          (project) => ({
            ...project,

            projectedOverrun:
              round2(
                Math.max(
                  project
                    .estimateAtCompletion -
                  project
                    .controlBudget,
                  0,
                ),
              ),
          }),
        ),
  };
}
