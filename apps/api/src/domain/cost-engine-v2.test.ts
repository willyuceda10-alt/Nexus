import { describe, expect, it } from 'vitest';
import {
  calculateBudgetLineForecastV2,
  calculateProjectCostSummaryV2,
} from './cost-engine-v2.js';

describe('Cost Engine V2', () => {
  it('combines actual, open commitments and uncommitted forecast into EAC', () => {
    const result = calculateProjectCostSummaryV2({
      plannedBudget: 1000,
      approvedBudget: 1000,
      contingencyAmount: 100,
      manualActual: 200,
      materialActual: 150,
      manualOpenCommitment: 100,
      materialOpenCommitment: 250,
      forecastRemainingUncommitted: 200,
    });
    expect(result.controlBudget).toBe(1100);
    expect(result.actualCost).toBe(350);
    expect(result.openCommitment).toBe(350);
    expect(result.estimateToComplete).toBe(550);
    expect(result.estimateAtCompletion).toBe(900);
    expect(result.varianceAtCompletion).toBe(200);
    expect(result.health).toBe('ON_TRACK');
  });

  it('marks a forecast above ten percent over control budget as critical', () => {
    const result = calculateProjectCostSummaryV2({
      plannedBudget: 1000,
      approvedBudget: 1000,
      contingencyAmount: 0,
      manualActual: 500,
      materialActual: 200,
      manualOpenCommitment: 300,
      materialOpenCommitment: 150,
      forecastRemainingUncommitted: 100,
    });
    expect(result.estimateAtCompletion).toBe(1250);
    expect(result.forecastVariancePercent).toBe(25);
    expect(result.health).toBe('CRITICAL');
  });

  it('derives remaining uncommitted forecast from approved amount when no override exists', () => {
    const result = calculateBudgetLineForecastV2({
      approvedAmount: 1000,
      actualAmount: 300,
      commitmentAmount: 250,
    });
    expect(result.forecastRemainingUncommitted).toBe(450);
    expect(result.estimateAtCompletion).toBe(1000);
    expect(result.forecastIsExplicit).toBe(false);
  });

  it('preserves a user forecast override even when it creates an overrun', () => {
    const result = calculateBudgetLineForecastV2({
      approvedAmount: 1000,
      actualAmount: 500,
      commitmentAmount: 300,
      forecastRemainingUncommitted: 400,
    });
    expect(result.estimateAtCompletion).toBe(1200);
    expect(result.varianceAtCompletion).toBe(-200);
    expect(result.forecastIsExplicit).toBe(true);
  });

  it('nets signed SAP-style reversals in actual cost without allowing negative commitments', () => {
    const project = calculateProjectCostSummaryV2({
      plannedBudget: 1000,
      approvedBudget: 1000,
      contingencyAmount: 0,
      manualActual: -20,
      materialActual: 100,
      manualOpenCommitment: 0,
      materialOpenCommitment: 0,
      forecastRemainingUncommitted: 900,
    });
    expect(project.actualCost).toBe(80);

    const line = calculateBudgetLineForecastV2({
      approvedAmount: 1000,
      actualAmount: -20,
      commitmentAmount: 0,
    });
    expect(line.actualAmount).toBe(-20);
    expect(line.forecastRemainingUncommitted).toBe(1020);
    expect(line.estimateAtCompletion).toBe(1000);
  });
});