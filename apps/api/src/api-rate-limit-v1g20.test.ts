import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  ApiRateLimiterV1g20,
  isApiRateLimitExemptPathV1g20,
} from './api-rate-limit-v1g20.js';

describe(
  'G20 API rate limiter',
  () => {
    it(
      'allows requests through the configured limit',
      () => {
        const limiter =
          new ApiRateLimiterV1g20({
            limit:
              2,

            windowMs:
              60_000,

            maxKeys:
              100,
          });

        expect(
          limiter.consume(
            'client-a',
            1_000,
          ).allowed,
        ).toBe(true);

        expect(
          limiter.consume(
            'client-a',
            2_000,
          ).allowed,
        ).toBe(true);

        const blocked =
          limiter.consume(
            'client-a',
            3_000,
          );

        expect(
          blocked.allowed,
        ).toBe(false);

        expect(
          blocked.remaining,
        ).toBe(0);

        expect(
          blocked.retryAfterSeconds,
        ).toBeGreaterThan(0);
      },
    );

    it(
      'opens a new window after expiration',
      () => {
        const limiter =
          new ApiRateLimiterV1g20({
            limit:
              1,

            windowMs:
              1_000,

            maxKeys:
              100,
          });

        expect(
          limiter.consume(
            'client-a',
            0,
          ).allowed,
        ).toBe(true);

        expect(
          limiter.consume(
            'client-a',
            500,
          ).allowed,
        ).toBe(false);

        expect(
          limiter.consume(
            'client-a',
            1_001,
          ).allowed,
        ).toBe(true);
      },
    );

    it(
      'keeps health routes outside the limiter',
      () => {
        expect(
          isApiRateLimitExemptPathV1g20(
            '/health/live',
          ),
        ).toBe(true);

        expect(
          isApiRateLimitExemptPathV1g20(
            '/health/ready',
          ),
        ).toBe(true);

        expect(
          isApiRateLimitExemptPathV1g20(
            '/health/risk-monitor?full=false',
          ),
        ).toBe(true);

        expect(
          isApiRateLimitExemptPathV1g20(
            '/api/v1/session',
          ),
        ).toBe(false);
      },
    );
  },
);
