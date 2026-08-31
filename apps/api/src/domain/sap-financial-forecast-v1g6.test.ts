import { describe, expect, it } from 'vitest';
import { buildSapFinancialForecastV1g6 } from './sap-financial-forecast-v1g6.js';

describe('SAP financial forecast V1-G6', () => {
  it('builds project forecast, baseline variance and risk exposure', () => {
    const result = buildSapFinancialForecastV1g6({
      controlBudget: 1100,
      actualCost: 400,
      openCommitment: 300,
      forecastRemainingUncommitted: 500,
      estimateAtCompletion: 1200,
      varianceAtCompletion: -100,
      forecastVariancePercent: 9.0909,
      health: 'HIGH',
      baselineApprovedBudget: 900,
      baselineContingencyAmount: 50,
      unallocatedActual: 25,
      unallocatedCommitment: 15,
      lines: [
        {
          id: 'line-risk',
          description: 'Material crítico',
          approvedAmount: 300,
          actualAmount: 200,
          commitmentAmount: 100,
          forecastRemainingUncommitted: 60,
          estimateAtCompletion: 360,
          varianceAtCompletion: -60,
        },
        {
          id: 'line-safe',
          description: 'Servicio controlado',
          approvedAmount: 500,
          actualAmount: 200,
          commitmentAmount: 100,
          forecastRemainingUncommitted: 180,
          estimateAtCompletion: 480,
          varianceAtCompletion: 20,
        },
      ],
    });

    expect(result.version).toBe('v1g6');
    expect(result.spentAndCommitted).toBe(700);
    expect(result.estimateToComplete).toBe(800);
    expect(result.remainingControlBudget).toBe(400);
    expect(result.estimateAtCompletion).toBe(1200);
    expect(result.varianceAtCompletion).toBe(-100);

    expect(result.budgetConsumedPercent).toBe(63.6364);
    expect(result.actualConsumedPercent).toBe(36.3636);
    expect(result.committedPercent).toBe(27.2727);

    expect(result.baseline.approvedBudget).toBe(900);
    expect(result.baseline.contingencyAmount).toBe(50);
    expect(result.baseline.controlBudget).toBe(950);
    expect(result.baseline.controlBudgetDelta).toBe(150);
    expect(result.baseline.controlBudgetDeltaPercent).toBe(15.7895);

    expect(result.exposure.unallocatedActual).toBe(25);
    expect(result.exposure.unallocatedCommitment).toBe(15);
    expect(result.exposure.unallocatedTotal).toBe(40);
    expect(result.exposure.linesAtRiskCount).toBe(1);

    expect(result.linesAtRisk).toHaveLength(1);
    expect(result.linesAtRisk[0]).toMatchObject({
      id: 'line-risk',
      projectedOverrun: 60,
      projectedOverrunPercent: 20,
    });
  });

  it('does not invent percentages when there is no control budget', () => {
    const result = buildSapFinancialForecastV1g6({
      controlBudget: 0,
      actualCost: 0,
      openCommitment: 0,
      forecastRemainingUncommitted: 0,
      estimateAtCompletion: 0,
      varianceAtCompletion: 0,
      forecastVariancePercent: null,
      health: 'NO_BUDGET',
      lines: [],
    });

    expect(result.budgetConsumedPercent).toBeNull();
    expect(result.actualConsumedPercent).toBeNull();
    expect(result.committedPercent).toBeNull();
    expect(result.baseline.approvedBudget).toBeNull();
    expect(result.linesAtRisk).toEqual([]);
  });
});
