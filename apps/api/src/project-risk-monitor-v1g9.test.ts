import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  shouldMonitorProjectV1g9,
} from './project-risk-monitor-v1g9.js';

describe(
  'shouldMonitorProjectV1g9',
  () => {
    it('monitors active project states', () => {
      expect(
        shouldMonitorProjectV1g9(
          'ACTIVE',
        ),
      ).toBe(true);

      expect(
        shouldMonitorProjectV1g9(
          'IN_PROGRESS',
        ),
      ).toBe(true);

      expect(
        shouldMonitorProjectV1g9(
          'TODO',
        ),
      ).toBe(true);
    });

    it('skips terminal project states', () => {
      for (
        const status
        of [
          'DONE',
          'COMPLETED',
          'CANCELLED',
          'CLOSED',
          'ARCHIVED',
        ]
      ) {
        expect(
          shouldMonitorProjectV1g9(
            status,
          ),
        ).toBe(false);
      }
    });

    it('normalizes status casing', () => {
      expect(
        shouldMonitorProjectV1g9(
          ' completed ',
        ),
      ).toBe(false);
    });
  },
);
