export type ApiSapFreshnessStateV1 = 'FRESH' | 'STALE' | 'PROCESSING' | 'ERROR' | 'NEVER' | 'DISABLED';
export type ApiSapQualityStateV1 = 'CLEAN' | 'WARNING' | 'REJECTED' | 'NO_DATA';
export type ApiSapConnectionHealthV1 = 'HEALTHY' | 'DEGRADED' | 'PROCESSING' | 'ERROR' | 'DISCONNECTED';

export interface ApiSapBatchV1 {
  id: string;
  status: string;
  originalFilename: string;
  sourceGeneratedAt: string | null;
  receivedAt: string;
  counts: {
    total: number;
    accepted: number;
    warnings: number;
    rejected: number;
  };
  errorSummary: string | null;
}

export interface ApiSapSourceHealthV1 {
  sourceId: string | null;
  sourceKey: string;
  displayName: string;
  configured: boolean;
  isActive: boolean;
  freshnessMinutes: number;
  freshnessState: ApiSapFreshnessStateV1;
  qualityState: ApiSapQualityStateV1;
  dataAgeMinutes: number | null;
  transportLagMinutes: number | null;
  lastSuccessAt: string | null;
  lastGeneratedAt: string | null;
  latestBatch: ApiSapBatchV1 | null;
  latestSuccessfulBatch: ApiSapBatchV1 | null;
}

export interface ApiSapConnectionV1 {
  id: string;
  displayName: string;
  status: string;
  overallStatus: ApiSapConnectionHealthV1;
  lastSyncAt: string | null;
  latestSuccessAt: string | null;
  updatedAt: string;
  automation: {
    configured: boolean;
    enabled: boolean;
    workspaceId: string | null;
  };
  summary: {
    expectedSources: number;
    configuredSources: number;
    fresh: number;
    stale: number;
    processing: number;
    errors: number;
    never: number;
    warnings: number;
    rejected: number;
  };
  sources: ApiSapSourceHealthV1[];
}

export interface ApiSapIntegrationCenterV1G1 {
  version: 'v1g1';
  canonicalDatabase: 'BRIDATA_POSTGRESQL';
  evaluatedAt: string;
  summary: {
    connections: number;
    healthy: number;
    degraded: number;
    processing: number;
    errors: number;
  };
  connections: ApiSapConnectionV1[];
}
