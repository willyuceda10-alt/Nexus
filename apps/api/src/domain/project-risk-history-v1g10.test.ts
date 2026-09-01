import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  buildProjectRiskHistoryV1g10,
  type ProjectRiskHistoryPointV1g10,
} from './project-risk-history-v1g10.js';

function point(
  id: string,
  observedAt: string,
  riskLevel:
    ProjectRiskHistoryPointV1g10['riskLevel'],
): ProjectRiskHistoryPointV1g10 {
  return {
    id,
    observedAt,
    riskLevel,

    drivers:
      riskLevel === 'ON_TRACK'
        ? []
        : ['COST_OVERRUN'],

    financialHealth:
      riskLevel ===
      'INSUFFICIENT_DATA'
        ? 'NO_BUDGET'
        : riskLevel,

    scheduleHealth:
      riskLevel ===
      'INSUFFICIENT_DATA'
        ? null
        : riskLevel,

    forecastVariancePercent: null,
    forecastVarianceDays: null,

    requiresAttention:
      riskLevel === 'WATCH' ||
      riskLevel === 'HIGH' ||
      riskLevel === 'CRITICAL',

    fingerprint: `fp-${id}`,
  };
}

describe(
  'buildProjectRiskHistoryV1g10',
  () => {
    it(
      'detects worsening risk',
      () => {
        const result =
          buildProjectRiskHistoryV1g10([
            point(
              '1',
              '2026-08-01T00:00:00.000Z',
              'WATCH',
            ),
            point(
              '2',
              '2026-08-02T00:00:00.000Z',
              'HIGH',
            ),
            point(
              '3',
              '2026-08-03T00:00:00.000Z',
              'CRITICAL',
            ),
          ]);

        expect(
          result.currentRisk,
        ).toBe('CRITICAL');

        expect(
          result.previousRisk,
        ).toBe('HIGH');

        expect(
          result.trend.current,
        ).toBe('WORSENING');

        expect(
          result.trend.net,
        ).toBe('WORSENING');

        expect(
          result.trend
            .worsenedTransitions,
        ).toBe(2);

        expect(
          result.maxRiskEver,
        ).toBe('CRITICAL');
      },
    );

    it(
      'detects improvement',
      () => {
        const result =
          buildProjectRiskHistoryV1g10([
            point(
              '1',
              '2026-08-01T00:00:00.000Z',
              'CRITICAL',
            ),
            point(
              '2',
              '2026-08-02T00:00:00.000Z',
              'HIGH',
            ),
            point(
              '3',
              '2026-08-03T00:00:00.000Z',
              'WATCH',
            ),
          ]);

        expect(
          result.trend.current,
        ).toBe('IMPROVING');

        expect(
          result.trend.net,
        ).toBe('IMPROVING');

        expect(
          result.trend
            .improvedTransitions,
        ).toBe(2);

        expect(
          result.maxRiskEver,
        ).toBe('CRITICAL');
      },
    );

    it(
      'detects stable risk and streak',
      () => {
        const result =
          buildProjectRiskHistoryV1g10([
            point(
              '1',
              '2026-08-01T00:00:00.000Z',
              'WATCH',
            ),
            point(
              '2',
              '2026-08-02T00:00:00.000Z',
              'HIGH',
            ),
            point(
              '3',
              '2026-08-03T00:00:00.000Z',
              'HIGH',
            ),
            point(
              '4',
              '2026-08-04T00:00:00.000Z',
              'HIGH',
            ),
          ]);

        expect(
          result.trend.current,
        ).toBe('STABLE');

        expect(
          result.trend
            .currentStreakCount,
        ).toBe(3);

        expect(
          result.trend
            .stableTransitions,
        ).toBe(2);
      },
    );

    it(
      'reports insufficient data with one observation',
      () => {
        const result =
          buildProjectRiskHistoryV1g10([
            point(
              '1',
              '2026-08-01T00:00:00.000Z',
              'ON_TRACK',
            ),
          ]);

        expect(
          result.trend.current,
        ).toBe(
          'INSUFFICIENT_DATA',
        );

        expect(
          result.observationCount,
        ).toBe(1);

        expect(
          result.currentRisk,
        ).toBe('ON_TRACK');
      },
    );
  },
);
