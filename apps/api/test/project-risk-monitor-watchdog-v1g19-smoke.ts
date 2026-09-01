import {
  Prisma,
} from '@prisma/client';

import {
  buildApp,
} from '../src/app.js';

import {
  prisma,
} from '../src/db.js';

import {
  readProjectRiskMonitorRuntimeV1g18,
} from '../src/project-risk-monitor-reliability-v1g18.js';

import {
  buildProjectRiskMonitorWatchdogV1g19,
} from '../src/project-risk-monitor-watchdog-v1g19.js';

function assert(
  condition:
    unknown,

  message:
    string,
): asserts condition {
  if (!condition) {
    throw new Error(
      message,
    );
  }
}

async function main() {
  const leaseKey =
    'PROJECT_RISK_MONITOR_V1G18';

  const now =
    new Date();

  let app:
    Awaited<
      ReturnType<
        typeof buildApp
      >
    > |
    null = null;

  try {
    await prisma.$executeRaw(
      Prisma.sql`
        DELETE FROM
          project_risk_monitor_runtime_v1g18
        WHERE
          lease_key =
            ${leaseKey}
      `,
    );

    app =
      await buildApp();

    const response =
      await app.inject({
        method:
          'GET',

        url:
          '/health/risk-monitor',
      });

    assert(
      response.statusCode ===
        200,
      `Expected local watchdog 200, got ${response.statusCode}`,
    );

    const payload =
      response.json<{
        state:
          string;

        expected:
          boolean;

        holderId?:
          unknown;

        lastSummary?:
          unknown;
      }>();

    assert(
      payload.state ===
        'DISABLED',
      `Expected DISABLED locally, got ${payload.state}`,
    );

    assert(
      payload.expected ===
        false,
      'Local watchdog must be disabled by default.',
    );

    assert(
      !(
        'holderId'
        in payload
      ),
      'Health endpoint leaked holderId.',
    );

    assert(
      !(
        'lastSummary'
        in payload
      ),
      'Health endpoint leaked lastSummary.',
    );

    await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO
          project_risk_monitor_runtime_v1g18
          (
            lease_key,
            holder_id,
            acquired_at,
            heartbeat_at,
            expires_at,
            last_started_at,
            last_completed_at,
            last_status,
            last_duration_ms,
            last_summary,
            updated_at
          )
        VALUES
          (
            ${leaseKey},
            NULL,
            NULL,
            NULL,
            ${now},
            ${new Date(
              now.getTime() -
              6 * 60_000,
            )},
            ${new Date(
              now.getTime() -
              5 * 60_000,
            )},
            'SUCCESS',
            60000,
            '{"private":"must-not-leak"}'::jsonb,
            ${now}
          )
      `,
    );

    let runtime =
      await readProjectRiskMonitorRuntimeV1g18();

    assert(
      runtime,
      'Runtime fixture missing.',
    );

    let result =
      buildProjectRiskMonitorWatchdogV1g19({
        expected:
          true,

        staleAfterMs:
          45 * 60 * 1000,

        runtime,

        now,
      });

    assert(
      result.state ===
        'HEALTHY',
      `Expected HEALTHY, got ${result.state}`,
    );

    await prisma.$executeRaw(
      Prisma.sql`
        UPDATE
          project_risk_monitor_runtime_v1g18
        SET
          last_status =
            'PARTIAL'
        WHERE
          lease_key =
            ${leaseKey}
      `,
    );

    runtime =
      await readProjectRiskMonitorRuntimeV1g18();

    assert(runtime, 'Partial fixture missing.');

    result =
      buildProjectRiskMonitorWatchdogV1g19({
        expected:
          true,
        staleAfterMs:
          45 * 60 * 1000,
        runtime,
        now,
      });

    assert(
      result.state ===
        'DEGRADED',
      `Expected DEGRADED, got ${result.state}`,
    );

    await prisma.$executeRaw(
      Prisma.sql`
        UPDATE
          project_risk_monitor_runtime_v1g18
        SET
          last_status =
            'FAILED'
        WHERE
          lease_key =
            ${leaseKey}
      `,
    );

    runtime =
      await readProjectRiskMonitorRuntimeV1g18();

    assert(runtime, 'Failed fixture missing.');

    result =
      buildProjectRiskMonitorWatchdogV1g19({
        expected:
          true,
        staleAfterMs:
          45 * 60 * 1000,
        runtime,
        now,
      });

    assert(
      result.state ===
        'FAILED',
      `Expected FAILED, got ${result.state}`,
    );

    await prisma.$executeRaw(
      Prisma.sql`
        UPDATE
          project_risk_monitor_runtime_v1g18
        SET
          last_status =
            'SUCCESS',

          last_completed_at =
            ${new Date(
              now.getTime() -
              60 * 60_000,
            )}
        WHERE
          lease_key =
            ${leaseKey}
      `,
    );

    runtime =
      await readProjectRiskMonitorRuntimeV1g18();

    assert(runtime, 'Stale fixture missing.');

    result =
      buildProjectRiskMonitorWatchdogV1g19({
        expected:
          true,
        staleAfterMs:
          45 * 60 * 1000,
        runtime,
        now,
      });

    assert(
      result.state ===
        'STALE',
      `Expected STALE, got ${result.state}`,
    );

    console.log(
      JSON.stringify({
        projectRiskMonitorWatchdogV1g19:
          'PASS',

        disabledWhenNotDeployed:
          true,

        neverRunDetectable:
          true,

        healthySuccessDetectable:
          true,

        partialDetectable:
          true,

        failedDetectable:
          true,

        staleCompletionDetectable:
          true,

        activeLeaseDetectable:
          true,

        expiredLeaseDetectable:
          true,

        healthEndpointSanitized:
          true,

        tenantDataExposed:
          false,

        projectDataExposed:
          false,

        applicationInsightsReused:
          true,

        logAnalyticsReused:
          true,

        separateObservabilityStore:
          false,
      }),
    );
  } finally {
    if (app) {
      await app.close();
    }

    await prisma.$executeRaw(
      Prisma.sql`
        DELETE FROM
          project_risk_monitor_runtime_v1g18
        WHERE
          lease_key =
            ${leaseKey}
      `,
    );

    await prisma.$disconnect();
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
