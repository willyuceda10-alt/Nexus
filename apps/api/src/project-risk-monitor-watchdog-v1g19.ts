import type {
  ProjectRiskMonitorRunStatusV1g18,
} from './project-risk-monitor-reliability-v1g18.js';

export type ProjectRiskMonitorOperationalStateV1g19 =
  | 'DISABLED'
  | 'NEVER_RUN'
  | 'RUNNING'
  | 'HEALTHY'
  | 'DEGRADED'
  | 'FAILED'
  | 'STALE';

export type ProjectRiskMonitorRuntimeSnapshotV1g19 = {
  holderId: string | null;
  acquiredAt: Date | null;
  heartbeatAt: Date | null;
  expiresAt: Date | null;
  lastStartedAt: Date | null;
  lastCompletedAt: Date | null;
  lastStatus: ProjectRiskMonitorRunStatusV1g18 | null;
  lastDurationMs: number | null;
};

function ageSeconds(
  date: Date | null,
  now: Date,
): number | null {
  if (!date) {
    return null;
  }

  return Math.max(
    Math.floor(
      (now.getTime() - date.getTime()) / 1000,
    ),
    0,
  );
}

export function buildProjectRiskMonitorWatchdogV1g19(
  input: {
    expected: boolean;
    staleAfterMs: number;
    runtime: ProjectRiskMonitorRuntimeSnapshotV1g19 | null;
    now?: Date;
  },
) {
  const now =
    input.now ??
    new Date();

  const staleAfterSeconds =
    Math.floor(
      input.staleAfterMs / 1000,
    );

  const base = {
    version:
      'v1g19' as const,

    expected:
      input.expected,

    staleAfterSeconds,

    lastStatus:
      input.runtime?.lastStatus ??
      null,

    lastStartedAt:
      input.runtime?.lastStartedAt ??
      null,

    lastCompletedAt:
      input.runtime?.lastCompletedAt ??
      null,

    heartbeatAt:
      input.runtime?.heartbeatAt ??
      null,

    expiresAt:
      input.runtime?.expiresAt ??
      null,

    lastDurationMs:
      input.runtime?.lastDurationMs ??
      null,

    lastCompletedAgeSeconds:
      ageSeconds(
        input.runtime?.lastCompletedAt ??
          null,
        now,
      ),
  };

  if (!input.expected) {
    return {
      ...base,
      state:
        'DISABLED' as const,
      healthy:
        true,
      running:
        false,
      reason:
        'MONITOR_NOT_EXPECTED',
    };
  }

  if (!input.runtime) {
    return {
      ...base,
      state:
        'NEVER_RUN' as const,
      healthy:
        false,
      running:
        false,
      reason:
        'RUNTIME_STATE_MISSING',
    };
  }

  if (input.runtime.holderId) {
    const leaseValid =
      input.runtime.expiresAt !==
        null &&
      input.runtime.expiresAt.getTime() >
        now.getTime();

    if (leaseValid) {
      return {
        ...base,
        state:
          'RUNNING' as const,
        healthy:
          true,
        running:
          true,
        reason:
          'ACTIVE_LEASE',
      };
    }

    return {
      ...base,
      state:
        'STALE' as const,
      healthy:
        false,
      running:
        false,
      reason:
        'ACTIVE_LEASE_EXPIRED',
    };
  }

  if (!input.runtime.lastCompletedAt) {
    return {
      ...base,
      state:
        'NEVER_RUN' as const,
      healthy:
        false,
      running:
        false,
      reason:
        'NO_COMPLETED_EXECUTION',
    };
  }

  const ageMs =
    Math.max(
      now.getTime() -
        input.runtime.lastCompletedAt.getTime(),
      0,
    );

  if (ageMs > input.staleAfterMs) {
    return {
      ...base,
      state:
        'STALE' as const,
      healthy:
        false,
      running:
        false,
      reason:
        'LAST_COMPLETION_TOO_OLD',
    };
  }

  switch (input.runtime.lastStatus) {
    case 'SUCCESS':
      return {
        ...base,
        state:
          'HEALTHY' as const,
        healthy:
          true,
        running:
          false,
        reason:
          'LAST_RUN_SUCCESS',
      };

    case 'PARTIAL':
      return {
        ...base,
        state:
          'DEGRADED' as const,
        healthy:
          false,
        running:
          false,
        reason:
          'LAST_RUN_PARTIAL',
      };

    case 'FAILED':
      return {
        ...base,
        state:
          'FAILED' as const,
        healthy:
          false,
        running:
          false,
        reason:
          'LAST_RUN_FAILED',
      };

    case 'SKIPPED_LOCKED':
      return {
        ...base,
        state:
          'DEGRADED' as const,
        healthy:
          false,
        running:
          false,
        reason:
          'SKIPPED_WITHOUT_ACTIVE_LEASE',
      };

    default:
      return {
        ...base,
        state:
          'DEGRADED' as const,
        healthy:
          false,
        running:
          false,
        reason:
          'UNKNOWN_LAST_RUN_STATE',
      };
  }
}
