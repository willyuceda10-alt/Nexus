import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { authenticate, resolveActor } from '../auth.js';
import {
  aggregateSapConnectionHealthV1e,
  evaluateSapSourceHealthV1e,
  resolveSapFreshnessMinutesV1e,
  SAP_EXPECTED_SOURCE_KEYS_V1E,
} from '../domain/sap-integration-health-v1e.js';
import { readSapAutomationProfileV1f2 } from '../domain/sap-orchestration-v1f2.js';
import { withTenant } from '../tenant-transaction.js';

type ConnectionRow = {
  id: string;
  status: string;
  display_name: string | null;
  config: Prisma.JsonValue | null;
  last_sync_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type SourceRow = {
  id: string;
  integration_connection_id: string;
  source_key: string;
  display_name: string;
  is_active: boolean;
  config: Prisma.JsonValue | null;
  last_success_at: Date | null;
  last_generated_at: Date | null;
};

type BatchRow = {
  integration_source_id: string;
  id: string;
  status: string;
  original_filename: string;
  source_generated_at: Date | null;
  received_at: Date;
  total_records: number;
  accepted_records: number;
  warning_records: number;
  rejected_records: number;
  error_summary: string | null;
};

const sourceDisplayNames: Record<string, string> = {
  SAP_PROCUREMENT_COMMITMENTS: 'Compromisos de compras',
  SAP_PROJECT_PROCUREMENT: 'Aprovisionamiento por proyecto',
  SAP_OPEN_PURCHASE_ORDERS: 'Pedidos abiertos / por llegar',
  SAP_MATERIAL_MOVEMENTS: 'Ingresos y salidas de material',
  SAP_PROJECT_ACTUAL_COSTS: 'Costos reales DATA PEP',
};

function batchDto(row: BatchRow | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    originalFilename: row.original_filename,
    sourceGeneratedAt: row.source_generated_at?.toISOString() ?? null,
    receivedAt: row.received_at.toISOString(),
    counts: {
      total: row.total_records,
      accepted: row.accepted_records,
      warnings: row.warning_records,
      rejected: row.rejected_records,
    },
    errorSummary: row.error_summary,
  };
}

export async function sapIntegrationCenterV1g1Routes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/integrations/sap/center-v1g1',
    { preHandler: [authenticate, resolveActor] },
    async (request) => {
      const actor = request.actor!;
      const now = new Date();

      const result = await withTenant(actor.tenantId, async (tx) => {
        const connections = await tx.$queryRaw<ConnectionRow[]>(Prisma.sql`
          SELECT id, status, display_name, config, last_sync_at, created_at, updated_at
          FROM integration_connections
          WHERE tenant_id = ${actor.tenantId}::uuid
            AND provider = 'SAP'
          ORDER BY updated_at DESC, created_at DESC, id
        `);

        const sources = await tx.$queryRaw<SourceRow[]>(Prisma.sql`
          SELECT s.id, s.integration_connection_id, s.source_key, s.display_name,
                 s.is_active, s.config, s.last_success_at, s.last_generated_at
          FROM integration_sources s
          JOIN integration_connections c
            ON c.id = s.integration_connection_id
           AND c.tenant_id = s.tenant_id
          WHERE s.tenant_id = ${actor.tenantId}::uuid
            AND c.provider = 'SAP'
          ORDER BY s.integration_connection_id, s.source_key
        `);

        const latestBatches = await tx.$queryRaw<BatchRow[]>(Prisma.sql`
          SELECT DISTINCT ON (b.integration_source_id)
                 b.integration_source_id, b.id, b.status, b.original_filename,
                 b.source_generated_at, b.received_at, b.total_records,
                 b.accepted_records, b.warning_records, b.rejected_records,
                 b.error_summary
          FROM integration_import_batches b
          JOIN integration_sources s
            ON s.id = b.integration_source_id
           AND s.tenant_id = b.tenant_id
          JOIN integration_connections c
            ON c.id = s.integration_connection_id
           AND c.tenant_id = s.tenant_id
          WHERE b.tenant_id = ${actor.tenantId}::uuid
            AND c.provider = 'SAP'
          ORDER BY b.integration_source_id, b.received_at DESC, b.id DESC
        `);

        const latestSuccessfulBatches = await tx.$queryRaw<BatchRow[]>(Prisma.sql`
          SELECT DISTINCT ON (b.integration_source_id)
                 b.integration_source_id, b.id, b.status, b.original_filename,
                 b.source_generated_at, b.received_at, b.total_records,
                 b.accepted_records, b.warning_records, b.rejected_records,
                 b.error_summary
          FROM integration_import_batches b
          JOIN integration_sources s
            ON s.id = b.integration_source_id
           AND s.tenant_id = b.tenant_id
          JOIN integration_connections c
            ON c.id = s.integration_connection_id
           AND c.tenant_id = s.tenant_id
          WHERE b.tenant_id = ${actor.tenantId}::uuid
            AND c.provider = 'SAP'
            AND b.status IN ('SUCCEEDED', 'PARTIAL')
          ORDER BY b.integration_source_id, b.received_at DESC, b.id DESC
        `);

        return { connections, sources, latestBatches, latestSuccessfulBatches };
      });

      const latestBySource = new Map(result.latestBatches.map((batch) => [batch.integration_source_id, batch]));
      const successfulBySource = new Map(result.latestSuccessfulBatches.map((batch) => [batch.integration_source_id, batch]));

      const connections = result.connections.map((connection) => {
        const configuredSources = result.sources.filter((source) => source.integration_connection_id === connection.id);
        const sourceByKey = new Map(configuredSources.map((source) => [source.source_key, source]));
        const extraKeys = configuredSources
          .map((source) => source.source_key)
          .filter((key) => !SAP_EXPECTED_SOURCE_KEYS_V1E.includes(key as never));
        const keys = [...SAP_EXPECTED_SOURCE_KEYS_V1E, ...extraKeys];

        const sources = keys.map((sourceKey) => {
          const source = sourceByKey.get(sourceKey);
          const latest = source ? latestBySource.get(source.id) : undefined;
          const successful = source ? successfulBySource.get(source.id) : undefined;
          const freshnessMinutes = resolveSapFreshnessMinutesV1e(source?.config ?? null);
          const health = evaluateSapSourceHealthV1e({
            configured: Boolean(source),
            isActive: source?.is_active ?? false,
            freshnessMinutes,
            lastSuccessAt: source?.last_success_at ?? null,
            lastGeneratedAt: source?.last_generated_at ?? null,
            latestBatchStatus: latest?.status ?? null,
            latestBatchReceivedAt: latest?.received_at ?? null,
            latestBatchSourceGeneratedAt: latest?.source_generated_at ?? null,
            latestSuccessfulBatchStatus: successful?.status ?? null,
            latestSuccessfulWarnings: successful?.warning_records ?? 0,
            latestSuccessfulRejected: successful?.rejected_records ?? 0,
          }, now);

          return {
            sourceId: source?.id ?? null,
            sourceKey,
            displayName: source?.display_name ?? sourceDisplayNames[sourceKey] ?? sourceKey,
            configured: Boolean(source),
            isActive: source?.is_active ?? false,
            freshnessMinutes,
            ...health,
            lastSuccessAt: source?.last_success_at?.toISOString() ?? null,
            lastGeneratedAt: source?.last_generated_at?.toISOString() ?? null,
            latestBatch: batchDto(latest),
            latestSuccessfulBatch: batchDto(successful),
          };
        });

        const profile = readSapAutomationProfileV1f2(connection.config);
        const overallStatus = aggregateSapConnectionHealthV1e(
          connection.status,
          sources.map((source) => source.freshnessState),
        );
        const latestSuccessAt = configuredSources
          .map((source) => source.last_success_at)
          .filter((value): value is Date => value !== null)
          .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

        return {
          id: connection.id,
          displayName: connection.display_name ?? 'SAP',
          status: connection.status,
          overallStatus,
          lastSyncAt: connection.last_sync_at?.toISOString() ?? null,
          latestSuccessAt: latestSuccessAt?.toISOString() ?? null,
          updatedAt: connection.updated_at.toISOString(),
          automation: {
            configured: Boolean(profile),
            enabled: profile?.enabled ?? false,
            workspaceId: profile?.workspaceId ?? null,
          },
          summary: {
            expectedSources: SAP_EXPECTED_SOURCE_KEYS_V1E.length,
            configuredSources: SAP_EXPECTED_SOURCE_KEYS_V1E.filter((key) => sourceByKey.has(key)).length,
            fresh: sources.filter((source) => source.freshnessState === 'FRESH').length,
            stale: sources.filter((source) => source.freshnessState === 'STALE').length,
            processing: sources.filter((source) => source.freshnessState === 'PROCESSING').length,
            errors: sources.filter((source) => source.freshnessState === 'ERROR').length,
            never: sources.filter((source) => source.freshnessState === 'NEVER').length,
            warnings: sources.filter((source) => source.qualityState === 'WARNING').length,
            rejected: sources.filter((source) => source.qualityState === 'REJECTED').length,
          },
          sources,
        };
      });

      return {
        version: 'v1g1',
        canonicalDatabase: 'BRIDATA_POSTGRESQL',
        evaluatedAt: now.toISOString(),
        summary: {
          connections: connections.length,
          healthy: connections.filter((connection) => connection.overallStatus === 'HEALTHY').length,
          degraded: connections.filter((connection) => connection.overallStatus === 'DEGRADED').length,
          processing: connections.filter((connection) => connection.overallStatus === 'PROCESSING').length,
          errors: connections.filter((connection) => connection.overallStatus === 'ERROR').length,
        },
        connections,
      };
    },
  );
}
