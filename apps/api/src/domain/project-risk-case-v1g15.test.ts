import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  projectRiskCaseTransitionV1g15,
} from './project-risk-case-v1g15.js';

describe(
  'G15 project risk case lifecycle',
  () => {
    it(
      'does nothing when risk is below HIGH and no case exists',
      () => {
        expect(
          projectRiskCaseTransitionV1g15({
            riskLevel:
              'WATCH',

            existingStatus:
              null,

            changed:
              true,
          }),
        ).toEqual({
          action:
            'NONE',

          nextStatus:
            null,
        });
      },
    );

    it(
      'creates an OPEN case for HIGH',
      () => {
        expect(
          projectRiskCaseTransitionV1g15({
            riskLevel:
              'HIGH',

            existingStatus:
              null,

            changed:
              true,
          }),
        ).toEqual({
          action:
            'CREATED',

          nextStatus:
            'OPEN',
        });
      },
    );

    it(
      'preserves acknowledged state while risk changes',
      () => {
        expect(
          projectRiskCaseTransitionV1g15({
            riskLevel:
              'CRITICAL',

            existingStatus:
              'ACKNOWLEDGED',

            changed:
              true,
          }),
        ).toEqual({
          action:
            'UPDATED',

          nextStatus:
            'ACKNOWLEDGED',
        });
      },
    );

    it(
      'auto resolves when canonical risk recovers',
      () => {
        expect(
          projectRiskCaseTransitionV1g15({
            riskLevel:
              'WATCH',

            existingStatus:
              'MITIGATING',

            changed:
              true,
          }),
        ).toEqual({
          action:
            'AUTO_RESOLVED',

          nextStatus:
            'RESOLVED',
        });
      },
    );

    it(
      'reopens a resolved case if risk becomes HIGH again',
      () => {
        expect(
          projectRiskCaseTransitionV1g15({
            riskLevel:
              'HIGH',

            existingStatus:
              'RESOLVED',

            changed:
              true,
          }),
        ).toEqual({
          action:
            'REOPENED',

          nextStatus:
            'OPEN',
        });
      },
    );
  },
);
