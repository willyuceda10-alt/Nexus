export type CostHealthV2 = 'NO_BUDGET' | 'ON_TRACK' | 'WATCH' | 'HIGH' | 'CRITICAL';

export interface ProjectCostTotalsV2Input {
  plannedBudget: number;
  approvedBudget: number;
  contingencyAmount: number;
  manualActual: number;
  materialActual: number;
  manualOpenCommitment: number;
  materialOpenCommitment: number;
  forecastRemainingUncommitted: number;
}

export class CostEngineV2ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CostEngineV2ValidationError';
  }
}

function amount(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new CostEngineV2ValidationError(`${field} must be finite and non-negative.`);
  }
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function signedAmount(value: number, field: string): number {
  if (!Number.isFinite(value)) {
    throw new CostEngineV2ValidationError(`${field} must be finite.`);
  }
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

export function calculateProjectCostSummaryV2(input: ProjectCostTotalsV2Input) {
  const plannedBudget = amount(input.plannedBudget, 'plannedBudget');
  const approvedBudget = amount(input.approvedBudget, 'approvedBudget');
  const contingencyAmount = amount(input.contingencyAmount, 'contingencyAmount');
  const manualActual = signedAmount(input.manualActual, 'manualActual');
  const materialActual = amount(input.materialActual, 'materialActual');
  const manualOpenCommitment = amount(input.manualOpenCommitment, 'manualOpenCommitment');
  const materialOpenCommitment = amount(input.materialOpenCommitment, 'materialOpenCommitment');
  const forecastRemainingUncommitted = amount(input.forecastRemainingUncommitted, 'forecastRemainingUncommitted');

  const controlBudget = round(approvedBudget + contingencyAmount);
  const actualCost = round(manualActual + materialActual);
  const openCommitment = round(manualOpenCommitment + materialOpenCommitment);
  const estimateToComplete = round(openCommitment + forecastRemainingUncommitted);
  const estimateAtCompletion = round(actualCost + estimateToComplete);
  const varianceAtCompletion = round(controlBudget - estimateAtCompletion);
  const spentAndCommitted = round(actualCost + openCommitment);
  const remainingAfterActualAndCommitment = round(controlBudget - spentAndCommitted);
  const forecastVariancePercent = controlBudget > 0
    ? round(((estimateAtCompletion - controlBudget) / controlBudget) * 100)
    : null;

  let health: CostHealthV2 = 'NO_BUDGET';
  if (controlBudget > 0) {
    const ratio = estimateAtCompletion / controlBudget;
    if (ratio <= 1) health = 'ON_TRACK';
    else if (ratio <= 1.05) health = 'WATCH';
    else if (ratio <= 1.1) health = 'HIGH';
    else health = 'CRITICAL';
  }

  return {
    plannedBudget,
    approvedBudget,
    contingencyAmount,
    controlBudget,
    actualCost,
    manualActual,
    materialActual,
    openCommitment,
    manualOpenCommitment,
    materialOpenCommitment,
    forecastRemainingUncommitted,
    estimateToComplete,
    estimateAtCompletion,
    varianceAtCompletion,
    forecastVariancePercent,
    spentAndCommitted,
    remainingAfterActualAndCommitment,
    health,
  };
}

export function calculateBudgetLineForecastV2(input: {
  approvedAmount: number;
  actualAmount: number;
  commitmentAmount: number;
  forecastRemainingUncommitted?: number | null;
}) {
  const approvedAmount = amount(input.approvedAmount, 'approvedAmount');
  const actualAmount = signedAmount(input.actualAmount, 'actualAmount');
  const commitmentAmount = amount(input.commitmentAmount, 'commitmentAmount');
  const explicitForecast = input.forecastRemainingUncommitted == null
    ? null
    : amount(input.forecastRemainingUncommitted, 'forecastRemainingUncommitted');
  const derivedUncommitted = Math.max(0, approvedAmount - actualAmount - commitmentAmount);
  const forecastRemainingUncommitted = explicitForecast ?? round(derivedUncommitted);
  const estimateAtCompletion = round(actualAmount + commitmentAmount + forecastRemainingUncommitted);

  return {
    approvedAmount,
    actualAmount,
    commitmentAmount,
    forecastRemainingUncommitted,
    estimateAtCompletion,
    varianceAtCompletion: round(approvedAmount - estimateAtCompletion),
    forecastIsExplicit: explicitForecast !== null,
  };
}