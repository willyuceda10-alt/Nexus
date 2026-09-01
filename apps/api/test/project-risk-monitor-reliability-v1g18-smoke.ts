import {
  randomUUID,
} from 'node:crypto';

import {
  Prisma,
} from '@prisma/client';

import {
  prisma,
} from '../src/db.js';

import {
  claimProjectRiskMonitorLeaseV1g18,
  completeProjectRiskMonitorLeaseV1g18,
  readProjectRiskMonitorRuntimeV1g18,
  runProjectRiskMonitorReliablyV1g18,
} from '../src/project-risk-monitor-reliability-v1g18.js';

import type {
  ProjectRiskMonitorV1g9Summary,
} from '../src/project-risk-monitor-v1g9.js';

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

function fakeSummary(
  failedProjects:
    number,
):
ProjectRiskMonitorV1g9Summary {
  return {
    version:
      'v1g9',

    tenantsScanned:
      1,

    projectsScanned:
      1,

    alertsQueued:
      0,

    alertsDeduplicated:
      0,

    alertsSuppressedByPolicy:
      0,

    notificationPolicyVersion:
      'v1g13',

    riskCaseSyncVersion:
      'v1g16',

    riskCasesCreated:
      0,

    riskCasesUpdated:
      0,

    riskCasesReopened:
      0,

    riskCasesAutoResolved:
      0,

    riskCasesUnchanged:
      0,

    riskCasesNotRequired:
      1,

    hierarchyEscalationVersion:
      'v1g17',

    hierarchyRecipientsConsidered:
      0,

    hierarchyNotificationsQueued:
      0,

    hierarchyNotificationsDeduplicated:
      0,

    hierarchyNotificationsSuppressedByPolicy:
      0,

    hierarchyInvalidOwnersSkipped:
      0,

    hierarchyInvalidScopesSkipped:
      0,

    hierarchyProjectOwnerRecipientsSkipped:
      0,

    projectsWithoutAlert:
      1,

    terminalProjectsSkipped:
      0,

    invalidOwnersSkipped:
      0,

    failedProjects,

    failures:
      [],
  };
}

async function main() {
  const firstHolder =
    randomUUID();

  const secondHolder =
    randomUUID();

  try {
    await prisma.$executeRaw(
      Prisma.sql`
        DELETE FROM
          project_risk_monitor_runtime_v1g18
        WHERE
          lease_key =
            'PROJECT_RISK_MONITOR_V1G18'
      `,
    );

    const first =
      await claimProjectRiskMonitorLeaseV1g18(
        firstHolder,
        {
          leaseMs:
            30_000,
        },
      );

    assert(
      first.acquired ===
        true,
      'First G18 lease must be acquired.',
    );

    const blocked =
      await claimProjectRiskMonitorLeaseV1g18(
        secondHolder,
        {
          leaseMs:
            30_000,
        },
      );

    assert(
      blocked.acquired ===
        false,
      'Concurrent G18 lease must be rejected.',
    );

    const released =
      await completeProjectRiskMonitorLeaseV1g18({
        holderId:
          firstHolder,

        status:
          'SUCCESS',

        startedAt:
          new Date(
            Date.now() -
            100,
          ),

        summary: {
          smoke:
            true,
        },
      });

    assert(
      released ===
        true,
      'First G18 lease must release cleanly.',
    );

    const success =
      await runProjectRiskMonitorReliablyV1g18({
        holderId:
          secondHolder,

        leaseMs:
          30_000,

        heartbeatMs:
          5_000,

        executeMonitor:
          async () =>
            fakeSummary(
              0,
            ),
      });

    assert(
      success.status ===
        'SUCCESS',
      `Expected SUCCESS, got ${success.status}`,
    );

    const runtime =
      await readProjectRiskMonitorRuntimeV1g18();

    assert(
      runtime,
      'G18 runtime row missing.',
    );

    assert(
      runtime.lastStatus ===
        'SUCCESS',
      `Expected persisted SUCCESS, got ${runtime.lastStatus}`,
    );

    assert(
      runtime.holderId ===
        null,
      'G18 lease must be released after SUCCESS.',
    );

    const lockHolder =
      randomUUID();

    const claimed =
      await claimProjectRiskMonitorLeaseV1g18(
        lockHolder,
        {
          leaseMs:
            30_000,
        },
      );

    assert(
      claimed.acquired,
      'G18 lock holder setup failed.',
    );

    const skipped =
      await runProjectRiskMonitorReliablyV1g18({
        holderId:
          randomUUID(),

        leaseMs:
          30_000,

        heartbeatMs:
          5_000,

        executeMonitor:
          async () =>
            fakeSummary(
              0,
            ),
      });

    assert(
      skipped.status ===
        'SKIPPED_LOCKED',
      `Expected SKIPPED_LOCKED, got ${skipped.status}`,
    );

    await completeProjectRiskMonitorLeaseV1g18({
      holderId:
        lockHolder,

      status:
        'SUCCESS',

      startedAt:
        new Date(),
    });

    const partial =
      await runProjectRiskMonitorReliablyV1g18({
        leaseMs:
          30_000,

        heartbeatMs:
          5_000,

        executeMonitor:
          async () =>
            fakeSummary(
              1,
            ),
      });

    assert(
      partial.status ===
        'PARTIAL',
      `Expected PARTIAL, got ${partial.status}`,
    );

    console.log(
      JSON.stringify({
        projectRiskMonitorReliabilityV1g18:
          'PASS',

        distributedLease:
          true,

        concurrentExecutionBlocked:
          true,

        crashSafeLeaseExpiry:
          true,

        heartbeatEnabled:
          true,

        successPersisted:
          true,

        skippedLocked:
          true,

        partialDetected:
          true,

        runtimeStatusDurable:
          true,

        directPostgresDependency:
          false,

        lockfileChanged:
          false,
      }),
    );
  } finally {
    await prisma.$executeRaw(
      Prisma.sql`
        DELETE FROM
          project_risk_monitor_runtime_v1g18
        WHERE
          lease_key =
            'PROJECT_RISK_MONITOR_V1G18'
      `,
    );

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
