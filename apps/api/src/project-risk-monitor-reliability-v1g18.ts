import {
  randomUUID,
} from 'node:crypto';

import {
  Prisma,
} from '@prisma/client';

import {
  prisma,
} from './db.js';

import {
  runProjectRiskMonitorV1g9,
  type ProjectRiskMonitorV1g9Options,
  type ProjectRiskMonitorV1g9Summary,
} from './project-risk-monitor-v1g9.js';

export type ProjectRiskMonitorRunStatusV1g18 =
  | 'SUCCESS'
  | 'PARTIAL'
  | 'FAILED'
  | 'SKIPPED_LOCKED';

export const
PROJECT_RISK_MONITOR_LEASE_KEY_V1G18 =
  'PROJECT_RISK_MONITOR_V1G18';

export const
PROJECT_RISK_MONITOR_LEASE_MS_V1G18 =
  20 * 60 * 1000;

export const
PROJECT_RISK_MONITOR_HEARTBEAT_MS_V1G18 =
  5 * 60 * 1000;

type RuntimeRowV1g18 = {
  lease_key:
    string;

  holder_id:
    string | null;

  acquired_at:
    Date | null;

  heartbeat_at:
    Date | null;

  expires_at:
    Date | null;

  last_started_at:
    Date | null;

  last_completed_at:
    Date | null;

  last_status:
    string | null;

  last_duration_ms:
    bigint | null;

  last_summary:
    Prisma.JsonValue |
    null;
};

export function
classifyProjectRiskMonitorRunV1g18(
  failedProjects:
    number,
):
Exclude<
  ProjectRiskMonitorRunStatusV1g18,
  'FAILED' |
  'SKIPPED_LOCKED'
> {
  return failedProjects > 0
    ? 'PARTIAL'
    : 'SUCCESS';
}

export async function
claimProjectRiskMonitorLeaseV1g18(
  holderId:
    string,

  options: {
    leaseMs?:
      number;

    now?:
      Date;
  } = {},
) {
  const now =
    options.now ??
    new Date();

  const leaseMs =
    options.leaseMs ??
    PROJECT_RISK_MONITOR_LEASE_MS_V1G18;

  const expiresAt =
    new Date(
      now.getTime() +
      leaseMs,
    );

  const rows =
    await prisma.$queryRaw<
      RuntimeRowV1g18[]
    >(Prisma.sql`
      INSERT INTO
        project_risk_monitor_runtime_v1g18
        (
          lease_key,
          holder_id,
          acquired_at,
          heartbeat_at,
          expires_at,
          last_started_at,
          updated_at
        )
      VALUES
        (
          ${PROJECT_RISK_MONITOR_LEASE_KEY_V1G18},
          ${holderId}::uuid,
          ${now},
          ${now},
          ${expiresAt},
          ${now},
          ${now}
        )
      ON CONFLICT (lease_key)
      DO UPDATE
      SET
        holder_id =
          EXCLUDED.holder_id,

        acquired_at =
          EXCLUDED.acquired_at,

        heartbeat_at =
          EXCLUDED.heartbeat_at,

        expires_at =
          EXCLUDED.expires_at,

        last_started_at =
          EXCLUDED.last_started_at,

        updated_at =
          EXCLUDED.updated_at

      WHERE
        project_risk_monitor_runtime_v1g18.expires_at
          IS NULL
        OR
        project_risk_monitor_runtime_v1g18.expires_at
          <= EXCLUDED.acquired_at

      RETURNING *
    `);

  return {
    acquired:
      rows.length === 1,

    holderId,

    acquiredAt:
      rows[0]
        ?.acquired_at ??
      null,

    expiresAt:
      rows[0]
        ?.expires_at ??
      null,
  };
}

export async function
heartbeatProjectRiskMonitorLeaseV1g18(
  holderId:
    string,

  options: {
    leaseMs?:
      number;

    now?:
      Date;
  } = {},
): Promise<boolean> {
  const now =
    options.now ??
    new Date();

  const leaseMs =
    options.leaseMs ??
    PROJECT_RISK_MONITOR_LEASE_MS_V1G18;

  const expiresAt =
    new Date(
      now.getTime() +
      leaseMs,
    );

  const updated =
    await prisma.$executeRaw(
      Prisma.sql`
        UPDATE
          project_risk_monitor_runtime_v1g18
        SET
          heartbeat_at =
            ${now},

          expires_at =
            ${expiresAt},

          updated_at =
            ${now}
        WHERE
          lease_key =
            ${PROJECT_RISK_MONITOR_LEASE_KEY_V1G18}
          AND holder_id =
            ${holderId}::uuid
      `,
    );

  return updated ===
    1;
}

export async function
completeProjectRiskMonitorLeaseV1g18(
  input: {
    holderId:
      string;

    status:
      Exclude<
        ProjectRiskMonitorRunStatusV1g18,
        'SKIPPED_LOCKED'
      >;

    startedAt:
      Date;

    completedAt?:
      Date;

    summary?:
      unknown;
  },
): Promise<boolean> {
  const completedAt =
    input.completedAt ??
    new Date();

  const durationMs =
    Math.max(
      completedAt.getTime() -
      input.startedAt.getTime(),
      0,
    );

  const updated =
    await prisma.$executeRaw(
      Prisma.sql`
        UPDATE
          project_risk_monitor_runtime_v1g18
        SET
          holder_id =
            NULL,

          heartbeat_at =
            ${completedAt},

          expires_at =
            ${completedAt},

          last_completed_at =
            ${completedAt},

          last_status =
            ${input.status},

          last_duration_ms =
            ${durationMs},

          last_summary =
            ${JSON.stringify(
              input.summary ??
              null,
            )}::jsonb,

          updated_at =
            ${completedAt}

        WHERE
          lease_key =
            ${PROJECT_RISK_MONITOR_LEASE_KEY_V1G18}
          AND holder_id =
            ${input.holderId}::uuid
      `,
    );

  return updated ===
    1;
}

export async function
recordProjectRiskMonitorSkippedV1g18(
  input: {
    attemptedAt?:
      Date;

    reason?:
      string;
  } = {},
) {
  const attemptedAt =
    input.attemptedAt ??
    new Date();

  await prisma.$executeRaw(
    Prisma.sql`
      UPDATE
        project_risk_monitor_runtime_v1g18
      SET
        last_status =
          'SKIPPED_LOCKED',

        last_summary =
          ${JSON.stringify({
            reason:
              input.reason ??
              'ACTIVE_LEASE',
          })}::jsonb,

        updated_at =
          ${attemptedAt}
      WHERE
        lease_key =
          ${PROJECT_RISK_MONITOR_LEASE_KEY_V1G18}
    `,
  );
}

export async function
readProjectRiskMonitorRuntimeV1g18() {
  const rows =
    await prisma.$queryRaw<
      RuntimeRowV1g18[]
    >(Prisma.sql`
      SELECT *
      FROM
        project_risk_monitor_runtime_v1g18
      WHERE
        lease_key =
          ${PROJECT_RISK_MONITOR_LEASE_KEY_V1G18}
      LIMIT 1
    `);

  const row =
    rows[0] ??
    null;

  if (!row) {
    return null;
  }

  return {
    version:
      'v1g18' as const,

    leaseKey:
      row.lease_key,

    holderId:
      row.holder_id,

    acquiredAt:
      row.acquired_at,

    heartbeatAt:
      row.heartbeat_at,

    expiresAt:
      row.expires_at,

    lastStartedAt:
      row.last_started_at,

    lastCompletedAt:
      row.last_completed_at,

    lastStatus:
      row.last_status as
        ProjectRiskMonitorRunStatusV1g18 |
        null,

    lastDurationMs:
      row.last_duration_ms ==
        null
        ? null
        : Number(
            row.last_duration_ms,
          ),

    lastSummary:
      row.last_summary,
  };
}

export async function
runProjectRiskMonitorReliablyV1g18(
  options: {
    monitorOptions?:
      ProjectRiskMonitorV1g9Options;

    executeMonitor?:
      (
        options:
          ProjectRiskMonitorV1g9Options,
      ) =>
        Promise<
          ProjectRiskMonitorV1g9Summary
        >;

    holderId?:
      string;

    leaseMs?:
      number;

    heartbeatMs?:
      number;
  } = {},
) {
  const startedAt =
    new Date();

  const holderId =
    options.holderId ??
    randomUUID();

  const lease =
    await claimProjectRiskMonitorLeaseV1g18(
      holderId,
      {
        ...(options.leaseMs !==
          undefined
          ? {
              leaseMs:
                options.leaseMs,
            }
          : {}),
      },
    );

  if (!lease.acquired) {
    await recordProjectRiskMonitorSkippedV1g18({
      attemptedAt:
        startedAt,

      reason:
        'ACTIVE_LEASE',
    });

    return {
      version:
        'v1g18' as const,

      status:
        'SKIPPED_LOCKED' as const,

      holderId,

      startedAt:
        startedAt
          .toISOString(),

      completedAt:
        new Date()
          .toISOString(),

      monitor:
        null,
    };
  }

  const leaseMs =
    options.leaseMs ??
    PROJECT_RISK_MONITOR_LEASE_MS_V1G18;

  const heartbeatMs =
    options.heartbeatMs ??
    PROJECT_RISK_MONITOR_HEARTBEAT_MS_V1G18;

  let heartbeatError:
    string |
    null = null;

  const timer =
    setInterval(
      () => {
        void heartbeatProjectRiskMonitorLeaseV1g18(
          holderId,
          {
            leaseMs,
          },
        )
          .then(
            (renewed) => {
              if (!renewed) {
                heartbeatError =
                  'LEASE_LOST';
              }
            },
          )
          .catch(
            (error: unknown) => {
              heartbeatError =
                error instanceof Error
                  ? error.message
                  : String(error);
            },
          );
      },
      heartbeatMs,
    );

  timer.unref();

  try {
    const executeMonitor =
      options.executeMonitor ??
      runProjectRiskMonitorV1g9;

    const monitor =
      await executeMonitor(
        options.monitorOptions ??
        {},
      );

    if (heartbeatError) {
      throw new Error(
        `Risk monitor lease heartbeat failed: ${heartbeatError}`,
      );
    }

    const status =
      classifyProjectRiskMonitorRunV1g18(
        monitor.failedProjects,
      );

    const completedAt =
      new Date();

    const released =
      await completeProjectRiskMonitorLeaseV1g18({
        holderId,
        status,
        startedAt,
        completedAt,

        summary: {
          version:
            'v1g18',

          monitor,
        },
      });

    if (!released) {
      throw new Error(
        'Risk monitor lease ownership was lost before completion.',
      );
    }

    return {
      version:
        'v1g18' as const,

      status,

      holderId,

      startedAt:
        startedAt
          .toISOString(),

      completedAt:
        completedAt
          .toISOString(),

      durationMs:
        completedAt.getTime() -
        startedAt.getTime(),

      monitor,
    };
  } catch (error) {
    const completedAt =
      new Date();

    await completeProjectRiskMonitorLeaseV1g18({
      holderId,

      status:
        'FAILED',

      startedAt,
      completedAt,

      summary: {
        version:
          'v1g18',

        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
    });

    throw error;
  } finally {
    clearInterval(
      timer,
    );
  }
}
