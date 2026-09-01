import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  buildProjectRiskMonitorWatchdogV1g19,
  type ProjectRiskMonitorRuntimeSnapshotV1g19,
} from './project-risk-monitor-watchdog-v1g19.js';

const now =
  new Date(
    '2026-09-01T10:00:00.000Z',
  );

function runtime(
  overrides:
    Partial<
      ProjectRiskMonitorRuntimeSnapshotV1g19
    > = {},
):
ProjectRiskMonitorRuntimeSnapshotV1g19 {
  return {
    holderId:
      null,

    acquiredAt:
      null,

    heartbeatAt:
      null,

    expiresAt:
      null,

    lastStartedAt:
      new Date(
        '2026-09-01T09:45:00.000Z',
      ),

    lastCompletedAt:
      new Date(
        '2026-09-01T09:46:00.000Z',
      ),

    lastStatus:
      'SUCCESS',

    lastDurationMs:
      60_000,

    ...overrides,
  };
}

describe(
  'G19 project risk monitor watchdog',
  () => {
    it(
      'detects disabled state',
      () => {
        const result =
          buildProjectRiskMonitorWatchdogV1g19({
            expected:
              false,

            staleAfterMs:
              45 * 60 * 1000,

            runtime:
              null,

            now,
          });

        expect(
          result.state,
        ).toBe(
          'DISABLED',
        );

        expect(
          result.healthy,
        ).toBe(true);
      },
    );

    it(
      'detects never run',
      () => {
        const result =
          buildProjectRiskMonitorWatchdogV1g19({
            expected:
              true,

            staleAfterMs:
              45 * 60 * 1000,

            runtime:
              null,

            now,
          });

        expect(
          result.state,
        ).toBe(
          'NEVER_RUN',
        );
      },
    );

    it(
      'detects active lease',
      () => {
        const result =
          buildProjectRiskMonitorWatchdogV1g19({
            expected:
              true,

            staleAfterMs:
              45 * 60 * 1000,

            runtime:
              runtime({
                holderId:
                  '11111111-1111-4111-8111-111111111111',

                expiresAt:
                  new Date(
                    '2026-09-01T10:10:00.000Z',
                  ),
              }),

            now,
          });

        expect(
          result.state,
        ).toBe(
          'RUNNING',
        );
      },
    );

    it(
      'detects expired lease',
      () => {
        const result =
          buildProjectRiskMonitorWatchdogV1g19({
            expected:
              true,

            staleAfterMs:
              45 * 60 * 1000,

            runtime:
              runtime({
                holderId:
                  '11111111-1111-4111-8111-111111111111',

                expiresAt:
                  new Date(
                    '2026-09-01T09:59:00.000Z',
                  ),
              }),

            now,
          });

        expect(
          result.state,
        ).toBe(
          'STALE',
        );
      },
    );

    it(
      'detects success',
      () => {
        expect(
          buildProjectRiskMonitorWatchdogV1g19({
            expected:
              true,

            staleAfterMs:
              45 * 60 * 1000,

            runtime:
              runtime(),

            now,
          }).state,
        ).toBe(
          'HEALTHY',
        );
      },
    );

    it(
      'detects partial',
      () => {
        expect(
          buildProjectRiskMonitorWatchdogV1g19({
            expected:
              true,

            staleAfterMs:
              45 * 60 * 1000,

            runtime:
              runtime({
                lastStatus:
                  'PARTIAL',
              }),

            now,
          }).state,
        ).toBe(
          'DEGRADED',
        );
      },
    );

    it(
      'detects failure',
      () => {
        expect(
          buildProjectRiskMonitorWatchdogV1g19({
            expected:
              true,

            staleAfterMs:
              45 * 60 * 1000,

            runtime:
              runtime({
                lastStatus:
                  'FAILED',
              }),

            now,
          }).state,
        ).toBe(
          'FAILED',
        );
      },
    );

    it(
      'detects stale completion',
      () => {
        expect(
          buildProjectRiskMonitorWatchdogV1g19({
            expected:
              true,

            staleAfterMs:
              45 * 60 * 1000,

            runtime:
              runtime({
                lastCompletedAt:
                  new Date(
                    '2026-09-01T09:00:00.000Z',
                  ),
              }),

            now,
          }).state,
        ).toBe(
          'STALE',
        );
      },
    );
  },
);
