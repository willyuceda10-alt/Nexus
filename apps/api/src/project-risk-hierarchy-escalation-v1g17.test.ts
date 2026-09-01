import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  hierarchyScopeIdsV1g17,
  shouldEscalateHierarchyRiskV1g17,
} from './project-risk-hierarchy-escalation-v1g17.js';

describe(
  'G17 hierarchy risk escalation',
  () => {
    it(
      'reads canonical program and portfolio metadata',
      () => {
        expect(
          hierarchyScopeIdsV1g17({
            programId:
              '11111111-1111-4111-8111-111111111111',

            portfolioId:
              '22222222-2222-4222-8222-222222222222',
          }),
        ).toEqual({
          programId:
            '11111111-1111-4111-8111-111111111111',

          portfolioId:
            '22222222-2222-4222-8222-222222222222',
        });
      },
    );

    it(
      'ignores malformed hierarchy metadata',
      () => {
        expect(
          hierarchyScopeIdsV1g17({
            programId:
              123,

            portfolioId:
              false,
          }),
        ).toEqual({
          programId:
            null,

          portfolioId:
            null,
        });
      },
    );

    it(
      'escalates CRITICAL',
      () => {
        expect(
          shouldEscalateHierarchyRiskV1g17(
            'CRITICAL',
          ),
        ).toBe(true);
      },
    );

    it(
      'does not escalate HIGH in G17',
      () => {
        expect(
          shouldEscalateHierarchyRiskV1g17(
            'HIGH',
          ),
        ).toBe(false);
      },
    );
  },
);
