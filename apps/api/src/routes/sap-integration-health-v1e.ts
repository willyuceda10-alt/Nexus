import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { isTenantAdministrator } from '../authorization.js';
import {
  aggregateSapConnectionHealthV1e,
  evaluateSapSourceHealthV1e,
  MAX_SAP_FRESHNESS_MINUTES_V1E,
  MIN_SAP_FRESHNESS_MINUTES_V1E,
  resolveSapFreshnessMinutesV1e,
  SAP_EXPECTED_SOURCE_KEYS_V1E,
} from '../domain/sap-integration-health-v1e.js';
import { withTenant } from '../tenant-transaction.js';

const connectionParams = z.object({ connectionId: z.string().uuid() });
const sourcePolicyParams = z.object({ connectionId: z.string().uuid(), sourceId: z.string().uuid() });
const freshnessPolicyBody = z.object({
  freshnessMinutes: z.number().int().min(MIN_SAP_FRESHNESS_MINUTES_V1E).max(MAX_SAP_FRESHNESS_MINUTES_V1E),
});

type ConnectionRow = {
  id: string;
  status: string;
  display_name: string | null;
};

type SourceRow = {
  id: string;
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
  source_generated_at: Date | null;
  received_at: Date;
  processing_started_at: Date | null;
  processing_finished_at: Date | null;
  total_records: number;
  accepted_records: number;
  warning_records: number;
  rejected_records: number;
  error_summary: string | null;
};

const sourceDisplayNames: Record<string, string> = {
  SAP_PROCUREMENT_COMMITMENTS: 'Compromisos de compras SAP',
  SAP_PROJECT_PROCUREMENT: 'Seguimiento de aprovisionamiento por proyecto',
  SAP_OPEN_PURCHASE_ORDERS: 'Pedidos abiertos y suministro pendiente SAP',
  SAP_MATERIAL_MOVEMENTS: 'Movimientos de material SAP',
  SAP_PROJECT_ACTUAL_COSTS: 'Costos reales por PEP SAP',
};

function batchDto(row: BatchRow | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    sourceGeneratedAt: row.source_generated_at?.toISOString() ?? null,
    receivedAt: row.received_at.toISOString(),
    processingStartedAt: row.processing_started_at?.toISOString() ?? null,
    processingFinishedAt: row.processing_finished_at?.toISOString() ?? null,
    counts: {
      total: row.total_records,
      accepted: row.accepted_records,
      warnings: row.warning_records,
      rejected: row.rejected_records,
    },
    errorSummary: row.error_summary,
  };
}

export async function sapIntegrationHealthV1eRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/integrations/sap/connections/:connectionId/health-v1e',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = connectionParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      const now = new Date();

      const result = await withTenant(actor.tenantId, async (tx) => {
        const connections = await tx.$queryRaw<ConnectionRow[]>(Prisma.sql`
          SELECT id, status, display_name
          FROM integration_connections
          WHERE tenant_id = ${actor.tenantId}::uuid
            AND id = ${params.data.connectionId}::uuid
            AND provider = 'SAP'
        `);
        const connection = connections[0];
        if (!connection) return { kind: 'not_found' as const };

        const sources = await tx.$queryRaw<SourceRow[]>(Prisma.sql`
          SELECT id, source_key, display_name, is_active, config,
                 last_success_at, last_generated_at
          FROM integration_sources
          WHERE tenant_id = ${actor.tenantId}::uuid
            AND integration_connection_id = ${connection.id}::uuid
          ORDER BY source_key
        `);

        const latestBatches = await tx.$queryRaw<BatchRow[]>(Prisma.sql`
          SELECT DISTINCT ON (b.integration_source_id)
                 b.integration_source_id, b.id, b.status, b.source_generated_at,
                 b.received_at, b.processing_started_at, b.processing_finished_at,
                 b.total_records, b.accepted_records, b.warning_records,
                 b.rejected_records, b.error_summary
          FROM integration_import_batches b
          JOIN integration_sources s ON s.id = b.integration_source_id AND s.tenant_id = b.tenant_id
          WHERE b.tenant_id = ${actor.tenantId}::uuid
            AND s.integration_connection_id = ${connection.id}::uuid
          ORDER BY b.integration_source_id, b.received_at DESC, b.id DESC
        `);

        const successfulBatches = await tx.$queryRaw<BatchRow[]>(Prisma.sql`
          SELECT DISTINCT ON (b.integration_source_id)
                 b.integration_source_id, b.id, b.status, b.source_generated_at,
                 b.received_at, b.processing_started_at, b.processing_finished_at,
                 b.total_records, b.accepted_records, b.warning_records,
                 b.rejected_records, b.error_summary
          FROM integration_import_batches b
          JOIN integration_sources s ON s.id = b.integration_source_id AND s.tenant_id = b.tenant_id
          WHERE b.tenant_id = ${actor.tenantId}::uuid
            AND s.integration_connection_id = ${connection.id}::uuid
            AND b.status IN ('SUCCEEDED', 'PARTIAL')
          ORDER BY b.integration_source_id, b.received_at DESC, b.id DESC
        `);

        return { kind: 'ok' as const, connection, sources, latestBatches, successfulBatches };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'sap_integration_connection_not_found' });

      const sourceByKey = new Map(result.sources.map((source) => [source.source_key, source]));
      const latestBySource = new Map(result.latestBatches.map((batch) => [batch.integration_source_id, batch]));
      const successfulBySource = new Map(result.successfulBatches.map((batch) => [batch.integration_source_id, batch]));
      const keys = [
        ...SAP_EXPECTED_SOURCE_KEYS_V1E,
        ...result.sources.map((source) => source.source_key).filter((key) => !SAP_EXPECTED_SOURCE_KEYS_V1E.includes(key as never)),
      ];

      const sourceHealth = keys.map((sourceKey) => {
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

      const overallStatus = aggregateSapConnectionHealthV1e(
        result.connection.status,
        sourceHealth.map((source) => source.freshnessState),
      );
      const latestSuccessAt = result.sources
        .map((source) => source.last_success_at)
        .filter((value): value is Date => value !== null)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

      return {
        connection: {
          id: result.connection.id,
          displayName: result.connection.display_name,
          status: result.connection.status,
          overallStatus,
          latestSuccessAt: latestSuccessAt?.toISOString() ?? null,
        },
        summary: {
          expectedSources: SAP_EXPECTED_SOURCE_KEYS_V1E.length,
          configuredExpectedSources: SAP_EXPECTED_SOURCE_KEYS_V1E.filter((key) => sourceByKey.has(key)).length,
          fresh: sourceHealth.filter((source) => source.freshnessState === 'FRESH').length,
          stale: sourceHealth.filter((source) => source.freshnessState === 'STALE').length,
          processing: sourceHealth.filter((source) => source.freshnessState === 'PROCESSING').length,
          errors: sourceHealth.filter((source) => source.freshnessState === 'ERROR').length,
          never: sourceHealth.filter((source) => source.freshnessState === 'NEVER').length,
          disabled: sourceHealth.filter((source) => source.freshnessState === 'DISABLED').length,
        },
        sources: sourceHealth,
        evaluatedAt: now.toISOString(),
      };
    },
  );

  app.put(
    '/api/v1/integrations/sap/connections/:connectionId/sources/:sourceId/freshness-v1e',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = sourcePolicyParams.safeParse(request.params);
      const body = freshnessPolicyBody.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send({ error: 'validation_error', details: body.success ? undefined : body.error.flatten() });
      }
      const actor = request.actor!;
      if (!isTenantAdministrator(actor)) return reply.code(403).send({ error: 'tenant_admin_required' });

      const result = await withTenant(actor.tenantId, async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string; source_key: string; config: Prisma.JsonValue | null }>>(Prisma.sql`
          UPDATE integration_sources s
          SET config = jsonb_set(
                COALESCE(s.config, '{}'::jsonb),
                '{freshnessMinutes}',
                to_jsonb(${body.data.freshnessMinutes}::integer),
                true
              ),
              updated_at = CURRENT_TIMESTAMP
          FROM integration_connections c
          WHERE s.tenant_id = ${actor.tenantId}::uuid
            AND s.id = ${params.data.sourceId}::uuid
            AND s.integration_connection_id = ${params.data.connectionId}::uuid
            AND c.id = s.integration_connection_id
            AND c.tenant_id = s.tenant_id
            AND c.provider = 'SAP'
          RETURNING s.id, s.source_key, s.config
        `);
        const source = rows[0];
        if (!source) return { kind: 'not_found' as const };

        await Promise.all([
          tx.auditLog.create({
            data: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              action: 'SAP_SOURCE_FRESHNESS_POLICY_UPDATED',
              resource: 'INTEGRATION_SOURCE',
              resourceId: source.id,
              correlationId: request.id,
              ipAddress: request.ip,
              details: {
                connectionId: params.data.connectionId,
                sourceKey: source.source_key,
                freshnessMinutes: body.data.freshnessMinutes,
              },
            },
          }),
          tx.domainEvent.create({
            data: {
              tenantId: actor.tenantId,
              aggregateId: source.id,
              eventType: 'bridata.integration.sap.freshness_policy.updated',
              payload: {
                connectionId: params.data.connectionId,
                sourceId: source.id,
                sourceKey: source.source_key,
                freshnessMinutes: body.data.freshnessMinutes,
                actorId: actor.userId,
              },
            },
          }),
        ]);
        return { kind: 'ok' as const, source };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'sap_integration_source_not_found' });
      return {
        sourceId: result.source.id,
        sourceKey: result.source.source_key,
        freshnessMinutes: resolveSapFreshnessMinutesV1e(result.source.config),
      };
    },
  );
}
