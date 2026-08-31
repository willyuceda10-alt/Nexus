export type SapFinancialForecastRiskV1g6 = 'NO_BUDGET' | 'ON_TRACK' | 'WATCH' | 'HIGH' | 'CRITICAL';

export interface SapFinancialForecastLineV1g6 {
  id: string;
  description: string;
  approvedAmount: number;
  actualAmount: number;
  commitmentAmount: number;
  forecastRemainingUncommitted: number;
  estimateAtCompletion: number;
  varianceAtCompletion: number;
}

export interface SapFinancialForecastInputV1g6 {
  controlBudget: number;
  actualCost: number;
  openCommitment: number;
  forecastRemainingUncommitted: number;
  estimateAtCompletion: number;
  varianceAtCompletion: number;
  forecastVariancePercent: number | null;
  health: SapFinancialForecastRiskV1g6;
  baselineApprovedBudget?: number | null;
  baselineContingencyAmount?: number | null;
  unallocatedActual?: number;
  unallocatedCommitment?: number;
  lines: SapFinancialForecastLineV1g6[];
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function percent(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return round((numerator / denominator) * 100);
}

export function buildSapFinancialForecastV1g6(input: SapFinancialForecastInputV1g6) {
  const spentAndCommitted = round(input.actualCost + input.openCommitment);
  const estimateToComplete = round(input.openCommitment + input.forecastRemainingUncommitted);
  const remainingControlBudget = round(input.controlBudget - spentAndCommitted);

  const linesAtRisk = input.lines
    .filter((line) => line.approvedAmount > 0 && line.estimateAtCompletion > line.approvedAmount)
    .map((line) => ({
      id: line.id,
      description: line.description,
      approvedAmount: round(line.approvedAmount),
      estimateAtCompletion: round(line.estimateAtCompletion),
      projectedOverrun: round(line.estimateAtCompletion - line.approvedAmount),
      projectedOverrunPercent: percent(
        line.estimateAtCompletion - line.approvedAmount,
        line.approvedAmount,
      ),
    }))
    .sort((a, b) => b.projectedOverrun - a.projectedOverrun);

  const baselineApprovedBudget = input.baselineApprovedBudget ?? null;
  const baselineContingencyAmount = input.baselineContingencyAmount ?? null;
  const baselineControlBudget = baselineApprovedBudget == null
    ? null
    : round(baselineApprovedBudget + (baselineContingencyAmount ?? 0));
  const baselineDelta = baselineControlBudget == null
    ? null
    : round(input.controlBudget - baselineControlBudget);

  const unallocatedActual = round(input.unallocatedActual ?? 0);
  const unallocatedCommitment = round(input.unallocatedCommitment ?? 0);

  return {
    version: 'v1g6' as const,
    controlBudget: round(input.controlBudget),
    actualCost: round(input.actualCost),
    openCommitment: round(input.openCommitment),
    spentAndCommitted,
    estimateToComplete,
    forecastRemainingUncommitted: round(input.forecastRemainingUncommitted),
    estimateAtCompletion: round(input.estimateAtCompletion),
    varianceAtCompletion: round(input.varianceAtCompletion),
    forecastVariancePercent: input.forecastVariancePercent,
    budgetConsumedPercent: percent(spentAndCommitted, input.controlBudget),
    actualConsumedPercent: percent(input.actualCost, input.controlBudget),
    committedPercent: percent(input.openCommitment, input.controlBudget),
    remainingControlBudget,
    health: input.health,
    baseline: {
      approvedBudget: baselineApprovedBudget,
      contingencyAmount: baselineContingencyAmount,
      controlBudget: baselineControlBudget,
      controlBudgetDelta: baselineDelta,
      controlBudgetDeltaPercent: baselineControlBudget == null
        ? null
        : percent(input.controlBudget - baselineControlBudget, baselineControlBudget),
    },
    exposure: {
      unallocatedActual,
      unallocatedCommitment,
      unallocatedTotal: round(unallocatedActual + unallocatedCommitment),
      linesAtRiskCount: linesAtRisk.length,
    },
    linesAtRisk,
  };
}
