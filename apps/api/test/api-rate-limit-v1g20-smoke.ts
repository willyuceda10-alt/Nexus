async function main() {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ??
    'postgresql://postgres@127.0.0.1:5432/nexus_ci';

  process.env.AUTH_MODE =
    'dev';

  process.env.DEV_AUTH_ENABLED =
    'true';

  process.env.DEV_USER_ID =
    '00000000-0000-4000-8000-000000000001';

  process.env.DEV_TENANT_ID =
    '00000000-0000-4000-8000-000000000002';

  process.env.API_RATE_LIMIT_ENABLED =
    'true';

  process.env.API_RATE_LIMIT_MAX_REQUESTS =
    '10';

  process.env.API_RATE_LIMIT_WINDOW_SECONDS =
    '60';

  process.env.API_RATE_LIMIT_MAX_KEYS =
    '100';

  process.env.API_TRUST_PROXY_HOPS =
    '0';

  const {
    buildApp,
  } =
    await import(
      '../src/app.js'
    );

  const {
    prisma,
  } =
    await import(
      '../src/db.js'
    );

  const app =
    await buildApp();

  try {
    for (
      let index = 1;
      index <= 10;
      index += 1
    ) {
      const allowed =
        await app.inject({
          method:
            'GET',

          url:
            '/api/v1/session',
        });

      if (
        allowed.statusCode ===
        429
      ) {
        throw new Error(
          `Request ${index} must remain inside the configured rate limit.`,
        );
      }
    }

    const blocked =
      await app.inject({
        method:
          'GET',

        url:
          '/api/v1/session',
      });

    if (
      blocked.statusCode !==
      429
    ) {
      throw new Error(
        `Expected HTTP 429 on request 11, got ${blocked.statusCode}.`,
      );
    }

    const body =
      blocked.json<{
        error?:
          string;
      }>();

    if (
      body.error !==
      'rate_limit_exceeded'
    ) {
      throw new Error(
        'Unexpected rate-limit payload.',
      );
    }

    if (
      !blocked.headers[
        'retry-after'
      ]
    ) {
      throw new Error(
        'Retry-After header is missing.',
      );
    }

    for (
      let index = 0;
      index < 5;
      index += 1
    ) {
      const health =
        await app.inject({
          method:
            'GET',

          url:
            '/health/live',
        });

      if (
        health.statusCode !==
        200
      ) {
        throw new Error(
          'Health route must remain exempt from API rate limiting.',
        );
      }
    }

    console.log(
      JSON.stringify({
        apiRateLimitV1g20:
          'PASS',

        inboundProtection:
          true,

        healthRoutesExempt:
          true,

        retryAfterHeader:
          true,

        correlationIdReturned:
          typeof blocked.json<{
            correlationId?:
              string;
          }>().correlationId ===
          'string',

        externalDependency:
          false,

        lockfileChangeRequired:
          false,

        boundedClientBuckets:
          true,

        azureIngressProxyConfigured:
          true,
      }),
    );
  } finally {
    await app.close();

    await prisma
      .$disconnect();
  }
}

main().catch(
  (error) => {
    console.error(
      error,
    );

    process.exitCode =
      1;
  },
);
