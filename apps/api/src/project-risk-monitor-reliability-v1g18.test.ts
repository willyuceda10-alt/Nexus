import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  classifyProjectRiskMonitorRunV1g18,
} from './project-risk-monitor-reliability-v1g18.js';

describe(
  'G18 project risk monitor reliability',
  () => {
    it(
      'classifies zero failures as SUCCESS',
      () => {
        expect(
          classifyProjectRiskMonitorRunV1g18(
            0,
          ),
        ).toBe(
          'SUCCESS',
        );
      },
    );

    it(
      'classifies project failures as PARTIAL',
      () => {
        expect(
          classifyProjectRiskMonitorRunV1g18(
            2,
          ),
        ).toBe(
          'PARTIAL',
        );
      },
    );
  },
);
