export type ApiRateLimitDecisionV1g20 = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAtMs: number;
  retryAfterSeconds: number;
};

type ApiRateLimitBucketV1g20 = {
  count: number;
  resetAtMs: number;
};

export type ApiRateLimiterOptionsV1g20 = {
  limit: number;
  windowMs: number;
  maxKeys: number;
};

export class ApiRateLimiterV1g20 {
  private readonly buckets =
    new Map<
      string,
      ApiRateLimitBucketV1g20
    >();

  constructor(
    private readonly options:
      ApiRateLimiterOptionsV1g20,
  ) {
    if (
      !Number.isInteger(options.limit) ||
      options.limit < 1
    ) {
      throw new Error(
        'Rate limit must be a positive integer.',
      );
    }

    if (
      !Number.isInteger(options.windowMs) ||
      options.windowMs < 1
    ) {
      throw new Error(
        'Rate limit window must be positive.',
      );
    }

    if (
      !Number.isInteger(options.maxKeys) ||
      options.maxKeys < 1
    ) {
      throw new Error(
        'Rate limit maxKeys must be positive.',
      );
    }
  }

  consume(
    rawKey: string,
    nowMs = Date.now(),
  ): ApiRateLimitDecisionV1g20 {
    const key =
      (
        rawKey.trim() ||
        'unknown'
      ).slice(
        0,
        128,
      );

    let bucket =
      this.buckets.get(
        key,
      );

    if (
      !bucket ||
      bucket.resetAtMs <= nowMs
    ) {
      this.evictExpired(
        nowMs,
      );

      this.ensureCapacity();

      bucket = {
        count: 1,
        resetAtMs:
          nowMs +
          this.options.windowMs,
      };

      this.buckets.set(
        key,
        bucket,
      );

      return this.buildDecision(
        true,
        bucket,
        nowMs,
      );
    }

    bucket.count += 1;

    return this.buildDecision(
      bucket.count <=
        this.options.limit,
      bucket,
      nowMs,
    );
  }

  private buildDecision(
    allowed: boolean,
    bucket: ApiRateLimitBucketV1g20,
    nowMs: number,
  ): ApiRateLimitDecisionV1g20 {
    return {
      allowed,

      limit:
        this.options.limit,

      remaining:
        Math.max(
          this.options.limit -
            bucket.count,
          0,
        ),

      resetAtMs:
        bucket.resetAtMs,

      retryAfterSeconds:
        Math.max(
          1,
          Math.ceil(
            (
              bucket.resetAtMs -
              nowMs
            ) /
              1000,
          ),
        ),
    };
  }

  private evictExpired(
    nowMs: number,
  ): void {
    for (
      const [
        key,
        bucket,
      ]
      of this.buckets
    ) {
      if (
        bucket.resetAtMs <=
        nowMs
      ) {
        this.buckets.delete(
          key,
        );
      }
    }
  }

  private ensureCapacity(): void {
    while (
      this.buckets.size >=
      this.options.maxKeys
    ) {
      const first =
        this.buckets
          .keys()
          .next();

      if (first.done) {
        return;
      }

      this.buckets.delete(
        first.value,
      );
    }
  }
}

export function
isApiRateLimitExemptPathV1g20(
  rawUrl: string,
): boolean {
  const path =
    rawUrl.split(
      '?',
      1,
    )[0] ??
    rawUrl;

  return (
    path === '/health' ||
    path.startsWith(
      '/health/',
    )
  );
}
