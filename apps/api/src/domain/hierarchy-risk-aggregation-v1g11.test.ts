import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  buildHierarchyRiskAggregationV1g11,
  type HierarchyRiskProjectV1g11,
} from './hierarchy-risk-aggregation-v1g11.js';

function project(
  id: string,
  risk:
    HierarchyRiskProjectV1g11['currentRisk'],
  trend:
    HierarchyRiskProjectV1g11['trend'],
): HierarchyRiskProjectV1g11 {
  return {
    projectId: id,
    title: `Project ${id}`,

    currentRisk: risk,
    trend,

    requiresAttention:
      risk === 'WATCH' ||
      risk === 'HIGH' ||
      risk === 'CRITICAL',

    lastObservedAt:
      '2026-09-01T00:00:00.000Z',

    hasRiskData:
      risk !== null &&
      risk !==
        'INSUFFICIENT_DATA',
  };
}

describe(
  'buildHierarchyRiskAggregationV1g11',
  () => {
    it(
      'aggregates critical program risk',
      () => {
        const result =
          buildHierarchyRiskAggregationV1g11({
            scopeType:
              'PROGRAM',

            projects: [
              project(
                'A',
                'CRITICAL',
                'WORSENING',
              ),

              project(
                'B',
                'HIGH',
                'STABLE',
              ),
            ],
          });

        expect(
          result.aggregateRisk,
        ).toBe('CRITICAL');

        expect(
          result.aggregateTrend,
        ).toBe('WORSENING');

        expect(
          result.highCriticalProjects,
        ).toBe(2);

        expect(
          result.highCriticalPercent,
        ).toBe(100);

        expect(
          result.riskCounts.CRITICAL,
        ).toBe(1);

        expect(
          result.riskCounts.HIGH,
        ).toBe(1);
      },
    );

    it(
      'calculates portfolio risk percentages',
      () => {
        const result =
          buildHierarchyRiskAggregationV1g11({
            scopeType:
              'PORTFOLIO',

            projects: [
              project(
                'A',
                'CRITICAL',
                'WORSENING',
              ),

              project(
                'B',
                'HIGH',
                'STABLE',
              ),

              project(
                'C',
                'ON_TRACK',
                'INSUFFICIENT_DATA',
              ),
            ],
          });

        expect(
          result.totalProjects,
        ).toBe(3);

        expect(
          result.projectsWithRiskData,
        ).toBe(3);

        expect(
          result.highCriticalPercent,
        ).toBe(66.67);

        expect(
          result.coveragePercent,
        ).toBe(100);

        expect(
          result.aggregateRisk,
        ).toBe('CRITICAL');
      },
    );

    it(
      'reports improvement when improving projects dominate',
      () => {
        const result =
          buildHierarchyRiskAggregationV1g11({
            scopeType:
              'PROGRAM',

            projects: [
              project(
                'A',
                'WATCH',
                'IMPROVING',
              ),

              project(
                'B',
                'ON_TRACK',
                'IMPROVING',
              ),

              project(
                'C',
                'WATCH',
                'STABLE',
              ),
            ],
          });

        expect(
          result.aggregateTrend,
        ).toBe('IMPROVING');
      },
    );

    it(
      'handles projects without risk history',
      () => {
        const result =
          buildHierarchyRiskAggregationV1g11({
            scopeType:
              'PORTFOLIO',

            projects: [
              project(
                'A',
                null,
                'INSUFFICIENT_DATA',
              ),
            ],
          });

        expect(
          result.aggregateRisk,
        ).toBe(
          'INSUFFICIENT_DATA',
        );

        expect(
          result.aggregateTrend,
        ).toBe(
          'INSUFFICIENT_DATA',
        );

        expect(
          result.projectsWithRiskData,
        ).toBe(0);

        expect(
          result.projectsWithoutRiskData,
        ).toBe(1);

        expect(
          result.coveragePercent,
        ).toBe(0);
      },
    );
  },
);
