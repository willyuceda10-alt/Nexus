import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  buildFinancialRiskExposureV1g12,
  type FinancialRiskProjectV1g12,
} from './hierarchy-financial-risk-v1g12.js';

function project(
  id: string,
  riskLevel:
    FinancialRiskProjectV1g12['riskLevel'],
  controlBudget: number,
  estimateAtCompletion: number,
): FinancialRiskProjectV1g12 {
  return {
    projectId: id,
    title: `Project ${id}`,

    riskLevel,
    currency: 'USD',

    controlBudget,
    estimateAtCompletion,

    varianceAtCompletion:
      controlBudget -
      estimateAtCompletion,

    financialDataSource:
      'RISK_SNAPSHOT',
  };
}

describe(
  'buildFinancialRiskExposureV1g12',
  () => {
    it(
      'calculates program financial exposure',
      () => {
        const result =
          buildFinancialRiskExposureV1g12({
            currency:
              'USD',

            projects: [
              project(
                'A',
                'CRITICAL',
                1000,
                1200,
              ),

              project(
                'B',
                'HIGH',
                500,
                550,
              ),
            ],
          });

        expect(
          result.totalControlBudget,
        ).toBe(1500);

        expect(
          result.totalEstimateAtCompletion,
        ).toBe(1750);

        expect(
          result.totalProjectedOverrun,
        ).toBe(250);

        expect(
          result.riskExposedControlBudget,
        ).toBe(1500);

        expect(
          result.riskExposedBudgetPercent,
        ).toBe(100);
      },
    );

    it(
      'calculates portfolio exposed budget percentage',
      () => {
        const result =
          buildFinancialRiskExposureV1g12({
            currency:
              'USD',

            projects: [
              project(
                'A',
                'CRITICAL',
                1000,
                1200,
              ),

              project(
                'B',
                'HIGH',
                500,
                550,
              ),

              project(
                'C',
                'ON_TRACK',
                500,
                480,
              ),
            ],
          });

        expect(
          result.totalControlBudget,
        ).toBe(2000);

        expect(
          result.totalEstimateAtCompletion,
        ).toBe(2230);

        expect(
          result.totalProjectedOverrun,
        ).toBe(250);

        expect(
          result.riskExposedControlBudget,
        ).toBe(1500);

        expect(
          result.riskExposedBudgetPercent,
        ).toBe(75);
      },
    );

    it(
      'does not count underrun as projected overrun',
      () => {
        const result =
          buildFinancialRiskExposureV1g12({
            currency:
              'USD',

            projects: [
              project(
                'A',
                'ON_TRACK',
                1000,
                900,
              ),
            ],
          });

        expect(
          result.totalProjectedOverrun,
        ).toBe(0);
      },
    );

    it(
      'orders highest monetary exposure first',
      () => {
        const result =
          buildFinancialRiskExposureV1g12({
            currency:
              'USD',

            projects: [
              project(
                'A',
                'HIGH',
                500,
                520,
              ),

              project(
                'B',
                'CRITICAL',
                500,
                700,
              ),
            ],
          });

        expect(
          result
            .topExposureProjects[0]
            ?.projectId,
        ).toBe('B');

        expect(
          result
            .topExposureProjects[0]
            ?.projectedOverrun,
        ).toBe(200);
      },
    );
  },
);
