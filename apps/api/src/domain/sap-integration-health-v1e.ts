export const SAP_EXPECTED_SOURCE_KEYS_V1E = [
  'SAP_PROCUREMENT_COMMITMENTS',
  'SAP_PROJECT_PROCUREMENT',
  'SAP_OPEN_PURCHASE_ORDERS',
  'SAP_MATERIAL_MOVEMENTS',
  'SAP_PROJECT_ACTUAL_COSTS',
] as const;

export type SapExpectedSourceKeyV1e = typeof SAP_EXPECTED_SOURCE_KEYS_V1E[number];
export type SapFreshnessStateV1e = 'FRESH' | 'STALE' | 'PROCESSING' | 'ERROR' | 'NEVER' | 'DISABLED';
export type SapQualityStateV1e = 'CLEAN' | 'WARNING' | 'REJECTED' | 'NO_DATA';
export type SapConnectionHealthV1e = 'HEALTHY' | 'DEGRADED' | 'PROCESSING' | 'ERROR' | 'DISCONNECTED';

export const DEFAULT_SAP_FRESHNESS_MINUTES_V1E = 24 * 60;
export const MIN_SAP_FRESHNESS_MINUTES_V1E = 5;
export const MAX_SAP_FRESHNESS_MINUTES_V1E = 7 * 24 * 60;

export type SapSourceHealthInputV1e = {
  configured: boolean;
  isActive: boolean;
  freshnessMinutes: number;
  lastSuccessAt: Date | null;
  lastGeneratedAt: Date | null;
  latestBatchStatus: string | null;
  latestBatchReceivedAt: Date | null;
  latestBatchSourceGeneratedAt: Date | null;
  latestSuccessfulBatchStatus: string | null;
  latestSuccessfulWarnings: number;
  latestSuccessfulRejected: number;
};

export type SapSourceHealthResultV1e = {
  freshnessState: SapFreshnessStateV1e;
  qualityState: SapQualityStateV1e;
  dataAgeMinutes: number | null;
  transportLagMinutes: number | null;
};

function roundedMinutes(milliseconds: number): number {
  return Math.max(0, Math.round(milliseconds / 60_000));
}

export function resolveSapFreshnessMinutesV1e(config: unknown): number {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return DEFAULT_SAP_FRESHNESS_MINUTES_V1E;
  }
  const raw = (config as Record<string, unknown>).freshnessMinutes;
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return DEFAULT_SAP_FRESHNESS_MINUTES_V1E;
  if (raw < MIN_SAP_FRESHNESS_MINUTES_V1E || raw > MAX_SAP_FRESHNESS_MINUTES_V1E) {
    return DEFAULT_SAP_FRESHNESS_MINUTES_V1E;
  }
  return raw;
}

export function evaluateSapSourceHealthV1e(
  input: SapSourceHealthInputV1e,
  now: Date = new Date(),
): SapSourceHealthResultV1e {
  if (!input.configured) {
    return { freshnessState: 'NEVER', qualityState: 'NO_DATA', dataAgeMinutes: null, transportLagMinutes: null };
  }
  if (!input.isActive) {
    return { freshnessState: 'DISABLED', qualityState: 'NO_DATA', dataAgeMinutes: null, transportLagMinutes: null };
  }

  const latestStatus = input.latestBatchStatus?.toUpperCase() ?? null;
  const latestIsNewerThanSuccess = Boolean(
    input.latestBatchReceivedAt
      && (!input.lastSuccessAt || input.latestBatchReceivedAt.getTime() > input.lastSuccessAt.getTime()),
  );

  let freshnessState: SapFreshnessStateV1e;
  if (latestStatus === 'FAILED' && latestIsNewerThanSuccess) {
    freshnessState = 'ERROR';
  } else if (['RECEIVED', 'PROCESSING'].includes(latestStatus ?? '') && latestIsNewerThanSuccess) {
    freshnessState = 'PROCESSING';
  } else if (!input.lastSuccessAt) {
    freshnessState = latestStatus === 'FAILED' ? 'ERROR' : latestStatus === 'PROCESSING' || latestStatus === 'RECEIVED' ? 'PROCESSING' : 'NEVER';
  } else {
    const dataTimestamp = input.lastGeneratedAt ?? input.lastSuccessAt;
    const ageMinutes = roundedMinutes(now.getTime() - dataTimestamp.getTime());
    freshnessState = ageMinutes > input.freshnessMinutes ? 'STALE' : 'FRESH';
  }

  let qualityState: SapQualityStateV1e = 'NO_DATA';
  if (input.latestSuccessfulBatchStatus) {
    if (input.latestSuccessfulRejected > 0 || input.latestSuccessfulBatchStatus.toUpperCase() === 'PARTIAL') {
      qualityState = 'REJECTED';
    } else if (input.latestSuccessfulWarnings > 0) {
      qualityState = 'WARNING';
    } else {
      qualityState = 'CLEAN';
    }
  }

  const dataTimestamp = input.lastGeneratedAt ?? input.lastSuccessAt;
  const dataAgeMinutes = dataTimestamp ? roundedMinutes(now.getTime() - dataTimestamp.getTime()) : null;
  const transportLagMinutes = input.latestBatchReceivedAt && input.latestBatchSourceGeneratedAt
    ? roundedMinutes(input.latestBatchReceivedAt.getTime() - input.latestBatchSourceGeneratedAt.getTime())
    : null;

  return { freshnessState, qualityState, dataAgeMinutes, transportLagMinutes };
}

export function aggregateSapConnectionHealthV1e(
  connectionStatus: string,
  sourceStates: SapFreshnessStateV1e[],
): SapConnectionHealthV1e {
  if (connectionStatus.toUpperCase() === 'DISCONNECTED') return 'DISCONNECTED';
  if (sourceStates.some((state) => state === 'ERROR')) return 'ERROR';
  if (sourceStates.some((state) => state === 'PROCESSING')) return 'PROCESSING';
  if (sourceStates.some((state) => state === 'STALE' || state === 'NEVER')) return 'DEGRADED';
  return 'HEALTHY';
}
