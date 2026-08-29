import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { isTenantAdministrator } from '../authorization.js';
import {
  buildSapReconciliationPlanV1c,
  type SapReconciliationCandidateV1c,
  type SapReconciliationRecordV1c,
} from '../domain/sap-reconciliation-v1c.js';
import { withTenant } from '../tenant-transaction.js';

const paramsSchema = z.object({ connectionId: z.string().uuid() });
const bodySchema = z.object({ dryRun: z.boolean().default(true) });
const INSERT_CHUNK_SIZE = 250;

type LatestRecordRow = {
  id: string;
  batch_id: string;
  source_key: string;
  parser_version: string;
  external_key: string | null;
  normalized_payload: Prisma.JsonValue | null;
};

type LatestBatchRow = {
  id: string;
  source_key: string;
  parser_version: string;
  status: string;
  source_generated_at: Date | null;
  received_at: Date;
};

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function jsonObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asJson(value: unknown): string {
  return JSON.stringify(value);
}

async function loadLatestRecords(
  tx: Prisma.TransactionClient,
  tenantId: string,
  connectionId: string,
): Promise<{ records: SapReconciliationRecordV1c[]; batches: LatestBatchRow[] }> {
  const batches = await tx.$queryRaw<LatestBatchRow[]>(Prisma.sql`
    WITH ranked AS (
      SELECT
        b.id,
        s.source_key,
        b.parser_version,
        b.status,
        b.source_generated_at,
        b.received_at,
        ROW_NUMBER() OVER (
          PARTITION BY s.id
          ORDER BY COALESCE(b.source_generated_at, b.received_at) DESC, b.received_at DESC, b.id DESC
        ) AS rn
      FROM integration_sources s
      JOIN integration_import_batches b
        ON b.integration_source_id = s.id
       AND b.tenant_id = s.tenant_id
      WHERE s.tenant_id = ${tenantId}::uuid
        AND s.integration_connection_id = ${connectionId}::uuid
        AND s.is_active = true
        AND b.status IN ('SUCCEEDED', 'PARTIAL')
    )
    SELECT id, source_key, parser_version, status, source_generated_at, received_at
    FROM ranked
    WHERE rn = 1
    ORDER BY source_key
  `);

  if (batches.length === 0) return { records: [], batches: [] };
  const batchIds = batches.map((batch) => batch.id);
  const rows = await tx.$queryRaw<LatestRecordRow[]>(Prisma.sql`
    SELECT
      r.id,
      r.batch_id,
      s.source_key,
      b.parser_version,
      r.external_key,
      r.normalized_payload
    FROM integration_import_records r
    JOIN integration_import_batches b
      ON b.id = r.batch_id
     AND b.tenant_id = r.tenant_id
    JOIN integration_sources s
      ON s.id = b.integration_source_id
     AND s.tenant_id = b.tenant_id
    WHERE r.tenant_id = ${tenantId}::uuid
      AND r.batch_id IN (${Prisma.join(batchIds.map((id) => Prisma.sql`${id}::uuid`))})
      AND r.validation_status <> 'INVALID'
      AND r.processing_status <> 'FAILED'
    ORDER BY s.source_key, r.row_number
  `);

  return {
    batches,
    records: rows.map((row) => ({
      id: row.id,
      batchId: row.batch_id,
      sourceKey: row.source_key,
      profileId: row.parser_version,
      externalKey: row.external_key,
      normalized: jsonObject(row.normalized_payload),
    })),
  };
}

async function persistCandidates(
  tx: Prisma.TransactionClient,
  tenantId: string,
  connectionId: string,
  candidates: SapReconciliationCandidateV1c[],
): Promise<number> {
  let touched = 0;
  for (const group of chunks(candidates, INSERT_CHUNK_SIZE)) {
    if (group.length === 0) continue;
    const values = group.map((candidate) => Prisma.sql`(
      ${tenantId}::uuid,
      ${connectionId}::uuid,
      ${candidate.leftRecordId}::uuid,
      ${candidate.rightRecordId}::uuid,
      ${candidate.relationshipType},
      ${candidate.matchMethod},
      ${candidate.confidence},
      ${candidate.status},
      ${asJson(candidate.evidence)}::jsonb,
      CURRENT_TIMESTAMP
    )`);
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      INSERT INTO integration_reconciliation_links
        (tenant_id, integration_connection_id, left_record_id, right_record_id,
         relationship_type, match_method, confidence, status, evidence, updated_at)
      VALUES ${Prisma.join(values)}
      ON CONFLICT (tenant_id, integration_connection_id, left_record_id, right_record_id, relationship_type)
      DO UPDATE SET
        match_method = EXCLUDED.match_method,
        confidence = EXCLUDED.confidence,
        status = EXCLUDED.status,
        evidence = EXCLUDED.evidence,
        updated_at = CURRENT_TIMESTAMP
      WHERE integration_reconciliation_links.confirmed_at IS NULL
      RETURNING id
    `);
    touched += rows.length;
  }
  return touched;
}

export async function sapIntegrationReconciliationV1cRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/v1/integrations/sap/connections/:connectionId/reconcile-v1c',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      const body = bodySchema.safeParse(request.body ?? {});
      if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      if (!isTenantAdministrator(actor)) return reply.code(403).send({ error: 'tenant_admin_required' });

      const result = await withTenant(actor.tenantId, async (tx) => {
        const connection = await tx.integrationConnection.findFirst({
          where: {
            id: params.data.connectionId,
            tenantId: actor.tenantId,
            provider: 'SAP',
          },
          select: { id: true, status: true },
        });
        if (!connection) return { kind: 'not_found' as const };
        if (connection.status === 'DISCONNECTED') return { kind: 'disconnected' as const };

        const latest = await loadLatestRecords(tx, actor.tenantId, connection.id);
        const plan = buildSapReconciliationPlanV1c(latest.records);
        if (body.data.dryRun) {
          return {
            kind: 'ok' as const,
            dryRun: true,
            appliedLinks: 0,
            latestBatches: latest.batches,
            plan,
          };
        }

        const appliedLinks = await persistCandidates(
          tx,
          actor.tenantId,
          connection.id,
          plan.candidates,
        );
        const batchIdentity = latest.batches.map((batch) => batch.id).sort().join('|');
        const runFingerprint = createHash('sha256').update(batchIdentity || 'empty').digest('hex').slice(0, 32);
        const eventIdempotencyKey = `sap-reconciliation-v1c:${connection.id}:${runFingerprint}`;

        await tx.auditLog.create({
          data: {
            tenantId: actor.tenantId,
            userId: actor.userId,
            action: 'SAP_RECONCILIATION_V1C_APPLIED',
            resource: 'INTEGRATION_CONNECTION',
            resourceId: connection.id,
            correlationId: request.id,
            ipAddress: request.ip,
            details: {
              latestBatchIds: latest.batches.map((batch) => batch.id),
              recordsConsidered: plan.summary.recordsConsidered,
              exactMatches: plan.summary.exactMatches,
              proposedMatches: plan.summary.proposedMatches,
              ambiguousMatches: plan.summary.ambiguousMatches,
              conflicts: plan.summary.conflicts,
              appliedLinks,
              canonicalWritesEnabled: false,
            },
          },
        });
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO domain_events
            (tenant_id, aggregate_id, event_type, payload, idempotency_key)
          VALUES
            (${actor.tenantId}::uuid, ${connection.id}::uuid,
             'bridata.integration.sap.reconciliation.v1c.applied',
             ${asJson({
               connectionId: connection.id,
               latestBatchIds: latest.batches.map((batch) => batch.id),
               summary: plan.summary,
               appliedLinks,
               actorId: actor.userId,
             })}::jsonb,
             ${eventIdempotencyKey})
          ON CONFLICT (idempotency_key) DO NOTHING
        `);

        return {
          kind: 'ok' as const,
          dryRun: false,
          appliedLinks,
          latestBatches: latest.batches,
          plan,
        };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'sap_integration_connection_not_found' });
      if (result.kind === 'disconnected') return reply.code(409).send({ error: 'sap_integration_connection_disconnected' });

      return reply.send({
        version: 'v1c',
        dryRun: result.dryRun,
        canonicalWriteEnabled: false,
        latestBatchPolicy: 'LATEST_SUCCEEDED_OR_PARTIAL_PER_LOGICAL_SOURCE',
        latestBatches: result.latestBatches.map((batch) => ({
          id: batch.id,
          sourceKey: batch.source_key,
          parserProfile: batch.parser_version,
          status: batch.status,
          sourceGeneratedAt: batch.source_generated_at?.toISOString() ?? null,
          receivedAt: batch.received_at.toISOString(),
        })),
        summary: result.plan.summary,
        conflicts: result.plan.conflicts,
        appliedLinks: result.appliedLinks,
        rules: {
          requisitionToPurchaseOrder: 'EXACT_REQUEST_AND_DOCUMENT_POSITION',
          commitmentToProcurement: 'EXACT_EXTERNAL_KEY_ONLY',
          purchaseOrderToReceipt: 'EXACT_DOCUMENT_POSITION_FOR_RECEIPTS_ONLY',
          reservationToIssue: 'NOT_AVAILABLE_UNTIL_RESERVATION_SOURCE_OR_EXACT_IDENTITY_EXISTS',
          movementToActualCost: 'PROPOSED_OR_AMBIGUOUS_WBS_MATERIAL_DATE_ABS_QUANTITY',
          materialDocumentItemRequiredForExactFinancialMatch: true,
        },
      });
    },
  );
}
