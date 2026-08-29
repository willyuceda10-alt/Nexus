import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { isTenantAdministrator, canManageWorkspace } from '../authorization.js';
import {
  buildSapFinancialGuardPlanV1d3,
  normalizeSapWbsElementV1d3,
  sapWbsExternalKeyV1d3,
  type SapFinancialSourceRecordV1d3,
  type SapWbsProjectMappingV1d3,
} from '../domain/sap-financial-guard-v1d3.js';
import { withTenant } from '../tenant-transaction.js';
import { projectCostCurrency, validProject, validWorkItem } from './cost-engine-v2-utils.js';

const connectionParams = z.object({ connectionId: z.string().uuid() });
const mappingBody = z.object({
  wbsElement: z.string().trim().min(1).max(240),
  projectId: z.string().uuid(),
  workItemId: z.string().uuid().nullable().optional(),
});
const syncBody = z.object({ dryRun: z.boolean().default(true) });

type LatestRecordRow = {
  id: string;
  source_key: string;
  external_key: string | null;
  normalized_payload: Prisma.JsonValue | null;
};
type MappingRow = {
  external_key: string;
  canonical_entity_id: string;
  metadata: Prisma.JsonValue | null;
  workspace_id: string;
};
type EntityLinkRow = {
  canonical_entity_id: string;
  canonical_entity_type: string;
};
type PurchaseOrderLineScopeRow = {
  line_id: string;
  purchase_order_id: string;
  workspace_id: string;
  project_object_id: string | null;
};

type Counters = {
  prePoInserted: number;
  prePoUpdated: number;
  prePoClosed: number;
  purchaseOrdersScoped: number;
  unchanged: number;
  actualsDeferred: number;
};

function jsonObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value).replace(/\.0+$/, '');
  return null;
}

function dateTimeOrNull(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function workItemFromMetadata(value: Prisma.JsonValue | null): string | null {
  const metadata = jsonObject(value);
  return typeof metadata.workItemId === 'string' ? metadata.workItemId : null;
}

function emptyCounters(actualsDeferred: number): Counters {
  return {
    prePoInserted: 0,
    prePoUpdated: 0,
    prePoClosed: 0,
    purchaseOrdersScoped: 0,
    unchanged: 0,
    actualsDeferred,
  };
}

async function loadLatestRecords(
  tx: Prisma.TransactionClient,
  tenantId: string,
  connectionId: string,
): Promise<SapFinancialSourceRecordV1d3[]> {
  const rows = await tx.$queryRaw<LatestRecordRow[]>(Prisma.sql`
    WITH latest_batches AS (
      SELECT id, source_key FROM (
        SELECT b.id,
               s.source_key,
               ROW_NUMBER() OVER (
                 PARTITION BY s.id
                 ORDER BY COALESCE(b.source_generated_at, b.received_at) DESC,
                          b.received_at DESC,
                          b.id DESC
               ) AS rn
        FROM integration_sources s
        JOIN integration_import_batches b
          ON b.integration_source_id = s.id
         AND b.tenant_id = s.tenant_id
        WHERE s.tenant_id = ${tenantId}::uuid
          AND s.integration_connection_id = ${connectionId}::uuid
          AND s.is_active = true
          AND b.status IN ('SUCCEEDED','PARTIAL')
      ) ranked
      WHERE rn = 1
    )
    SELECT r.id, lb.source_key, r.external_key, r.normalized_payload
    FROM latest_batches lb
    JOIN integration_import_records r ON r.batch_id = lb.id
    WHERE r.tenant_id = ${tenantId}::uuid
      AND r.validation_status <> 'INVALID'
      AND r.processing_status <> 'FAILED'
    ORDER BY lb.source_key, r.row_number
  `);
  return rows.map((row) => ({
    id: row.id,
    sourceKey: row.source_key,
    externalKey: row.external_key,
    normalized: jsonObject(row.normalized_payload),
  }));
}

async function loadWbsMappings(
  tx: Prisma.TransactionClient,
  tenantId: string,
  connectionId: string,
): Promise<SapWbsProjectMappingV1d3[]> {
  const rows = await tx.$queryRaw<MappingRow[]>(Prisma.sql`
    SELECT link.external_key,
           link.canonical_entity_id,
           link.metadata,
           project.workspace_id
    FROM integration_entity_links link
    JOIN nexus_objects project
      ON project.id = link.canonical_entity_id
     AND project.tenant_id = link.tenant_id
    WHERE link.tenant_id = ${tenantId}::uuid
      AND link.integration_connection_id = ${connectionId}::uuid
      AND link.external_entity_type = 'SAP_WBS_ELEMENT'
      AND link.canonical_entity_type = 'PROJECT_OBJECT'
      AND project.object_type_key = 'PROJECT'
      AND project.deleted_at IS NULL
    ORDER BY link.external_key
  `);
  return rows.flatMap((row) => {
    if (!row.external_key.startsWith('WBS:')) return [];
    return [{
      wbsElement: row.external_key.slice(4),
      projectId: row.canonical_entity_id,
      workspaceId: row.workspace_id,
      workItemId: workItemFromMetadata(row.metadata),
    }];
  });
}

async function findEntityLink(
  tx: Prisma.TransactionClient,
  tenantId: string,
  connectionId: string,
  externalType: string,
  externalKey: string,
): Promise<EntityLinkRow | null> {
  const rows = await tx.$queryRaw<EntityLinkRow[]>(Prisma.sql`
    SELECT canonical_entity_id, canonical_entity_type
    FROM integration_entity_links
    WHERE tenant_id = ${tenantId}::uuid
      AND integration_connection_id = ${connectionId}::uuid
      AND external_entity_type = ${externalType}
      AND external_key = ${externalKey}
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function saveEntityLink(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    connectionId: string;
    sourceRecordId: string | null;
    externalType: string;
    externalKey: string;
    canonicalType: string;
    canonicalId: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO integration_entity_links
      (tenant_id, integration_connection_id, source_record_id,
       external_entity_type, external_key, canonical_entity_type, canonical_entity_id,
       metadata, last_seen_at, updated_at)
    VALUES
      (${input.tenantId}::uuid, ${input.connectionId}::uuid, ${input.sourceRecordId}::uuid,
       ${input.externalType}, ${input.externalKey}, ${input.canonicalType}, ${input.canonicalId}::uuid,
       ${JSON.stringify(input.metadata)}::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (tenant_id, integration_connection_id, external_entity_type, external_key)
    DO UPDATE SET source_record_id = EXCLUDED.source_record_id,
                  canonical_entity_type = EXCLUDED.canonical_entity_type,
                  canonical_entity_id = EXCLUDED.canonical_entity_id,
                  metadata = EXCLUDED.metadata,
                  last_seen_at = CURRENT_TIMESTAMP,
                  updated_at = CURRENT_TIMESTAMP
  `);
}

async function lockExternalFinancialIdentity(
  tx: Prisma.TransactionClient,
  tenantId: string,
  connectionId: string,
  externalKey: string,
): Promise<void> {
  await tx.$executeRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`${tenantId}:${connectionId}:SAP_FINANCIAL:${externalKey}`}, 0)
    )
  `);
}

async function closePrePoCommitment(
  tx: Prisma.TransactionClient,
  tenantId: string,
  connectionId: string,
  prKey: string,
): Promise<'closed' | 'unchanged' | 'missing' | 'conflict'> {
  const link = await findEntityLink(tx, tenantId, connectionId, 'SAP_PRE_PO_COMMITMENT', prKey);
  if (!link) return 'missing';
  if (link.canonical_entity_type !== 'PROJECT_COMMITMENT') return 'conflict';
  const rows = await tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`
    SELECT status FROM project_commitments
    WHERE id = ${link.canonical_entity_id}::uuid AND tenant_id = ${tenantId}::uuid
  `);
  if (!rows[0]) return 'missing';
  if (rows[0].status === 'CLOSED') return 'unchanged';
  await tx.$executeRaw(Prisma.sql`
    UPDATE project_commitments
    SET released_amount = amount,
        status = 'CLOSED',
        notes = CASE
          WHEN notes IS NULL OR notes = '' THEN 'Cerrado automáticamente: la SolP fue convertida a Pedido SAP.'
          ELSE notes || E'\nCerrado automáticamente: la SolP fue convertida a Pedido SAP.'
        END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ${link.canonical_entity_id}::uuid AND tenant_id = ${tenantId}::uuid
  `);
  return 'closed';
}

async function scopePurchaseOrderToProject(
  tx: Prisma.TransactionClient,
  tenantId: string,
  connectionId: string,
  poKey: string,
  workspaceId: string,
  projectId: string,
): Promise<'updated' | 'unchanged' | 'missing' | 'conflict'> {
  const link = await findEntityLink(tx, tenantId, connectionId, 'SAP_PURCHASE_ORDER_LINE', poKey);
  if (!link || link.canonical_entity_type !== 'PURCHASE_ORDER_LINE') return link ? 'conflict' : 'missing';
  const rows = await tx.$queryRaw<PurchaseOrderLineScopeRow[]>(Prisma.sql`
    SELECT pol.id AS line_id,
           po.id AS purchase_order_id,
           po.workspace_id,
           po.project_object_id
    FROM purchase_order_lines pol
    JOIN purchase_orders po ON po.id = pol.purchase_order_id
    WHERE pol.id = ${link.canonical_entity_id}::uuid
      AND pol.tenant_id = ${tenantId}::uuid
      AND po.tenant_id = ${tenantId}::uuid
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) return 'missing';
  if (row.workspace_id !== workspaceId) return 'conflict';
  if (row.project_object_id && row.project_object_id !== projectId) return 'conflict';
  if (row.project_object_id === projectId) return 'unchanged';
  await tx.$executeRaw(Prisma.sql`
    UPDATE purchase_orders
    SET project_object_id = ${projectId}::uuid,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ${row.purchase_order_id}::uuid
      AND tenant_id = ${tenantId}::uuid
  `);
  return 'updated';
}

export async function sapIntegrationFinancialGuardV1d3Routes(app: FastifyInstance): Promise<void> {
  app.put(
    '/api/v1/integrations/sap/connections/:connectionId/wbs-mappings-v1d3',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = connectionParams.safeParse(request.params);
      const body = mappingBody.safeParse(request.body);
      if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      if (!isTenantAdministrator(actor)) return reply.code(403).send({ error: 'tenant_admin_required' });

      const result = await withTenant(actor.tenantId, async (tx) => {
        const connection = await tx.integrationConnection.findFirst({
          where: { id: params.data.connectionId, tenantId: actor.tenantId, provider: 'SAP' },
          select: { id: true, status: true },
        });
        if (!connection) return { kind: 'not_found' as const };
        if (connection.status === 'DISCONNECTED') return { kind: 'disconnected' as const };
        const project = await validProject(tx, actor.tenantId, body.data.projectId);
        if (!project) return { kind: 'project_not_found' as const };
        if (!(await canManageWorkspace(tx, actor, project.workspaceId))) return { kind: 'forbidden' as const };
        if (!(await validWorkItem(
          tx,
          actor.tenantId,
          project.workspaceId,
          project.id,
          body.data.workItemId ?? null,
        ))) return { kind: 'work_item_not_found' as const };

        const wbsElement = normalizeSapWbsElementV1d3(body.data.wbsElement);
        const externalKey = sapWbsExternalKeyV1d3(wbsElement);
        await saveEntityLink(tx, {
          tenantId: actor.tenantId,
          connectionId: connection.id,
          sourceRecordId: null,
          externalType: 'SAP_WBS_ELEMENT',
          externalKey,
          canonicalType: 'PROJECT_OBJECT',
          canonicalId: project.id,
          metadata: {
            source: 'SAP',
            mappingVersion: 'v1d3',
            workspaceId: project.workspaceId,
            workItemId: body.data.workItemId ?? null,
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId: actor.tenantId,
            userId: actor.userId,
            action: 'SAP_WBS_PROJECT_MAPPING_UPSERTED',
            resource: 'INTEGRATION_CONNECTION',
            resourceId: connection.id,
            correlationId: request.id,
            ipAddress: request.ip,
            details: {
              wbsElement,
              projectId: project.id,
              workspaceId: project.workspaceId,
              workItemId: body.data.workItemId ?? null,
            },
          },
        });
        return {
          kind: 'ok' as const,
          payload: {
            wbsElement,
            externalKey,
            projectId: project.id,
            workspaceId: project.workspaceId,
            workItemId: body.data.workItemId ?? null,
          },
        };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'sap_integration_connection_not_found' });
      if (result.kind === 'disconnected') return reply.code(409).send({ error: 'sap_integration_connection_disconnected' });
      if (result.kind === 'project_not_found') return reply.code(404).send({ error: 'project_not_found' });
      if (result.kind === 'work_item_not_found') return reply.code(404).send({ error: 'work_item_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_management_denied' });
      return result.payload;
    },
  );

  app.get(
    '/api/v1/integrations/sap/connections/:connectionId/wbs-mappings-v1d3',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = connectionParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      if (!isTenantAdministrator(actor)) return reply.code(403).send({ error: 'tenant_admin_required' });
      const result = await withTenant(actor.tenantId, async (tx) => {
        const connection = await tx.integrationConnection.findFirst({
          where: { id: params.data.connectionId, tenantId: actor.tenantId, provider: 'SAP' },
          select: { id: true },
        });
        if (!connection) return { kind: 'not_found' as const };
        return { kind: 'ok' as const, mappings: await loadWbsMappings(tx, actor.tenantId, connection.id) };
      });
      if (result.kind === 'not_found') return reply.code(404).send({ error: 'sap_integration_connection_not_found' });
      return { version: 'v1d3', mappings: result.mappings };
    },
  );

  app.post(
    '/api/v1/integrations/sap/connections/:connectionId/financial-guard-v1d3',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = connectionParams.safeParse(request.params);
      const body = syncBody.safeParse(request.body ?? {});
      if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      if (!isTenantAdministrator(actor)) return reply.code(403).send({ error: 'tenant_admin_required' });

      const result = await withTenant(actor.tenantId, async (tx) => {
        const connection = await tx.integrationConnection.findFirst({
          where: { id: params.data.connectionId, tenantId: actor.tenantId, provider: 'SAP' },
          select: { id: true, status: true },
        });
        if (!connection) return { kind: 'not_found' as const };
        if (connection.status === 'DISCONNECTED') return { kind: 'disconnected' as const };

        const [records, mappings] = await Promise.all([
          loadLatestRecords(tx, actor.tenantId, connection.id),
          loadWbsMappings(tx, actor.tenantId, connection.id),
        ]);
        const plan = buildSapFinancialGuardPlanV1d3(records, mappings);
        const counters = emptyCounters(plan.summary.actualRecordsDeferred);
        const blockers = [...plan.blockers];

        if (body.data.dryRun) {
          return { kind: 'ok' as const, dryRun: true, plan, counters, blockers };
        }

        for (const candidate of plan.prePoCommitments) {
          await lockExternalFinancialIdentity(tx, actor.tenantId, connection.id, candidate.externalKey);
          const project = await validProject(tx, actor.tenantId, candidate.projectId);
          if (!project || project.workspaceId !== candidate.workspaceId) {
            blockers.push({ recordId: candidate.recordId, code: 'WBS_PROJECT_MAPPING_STALE' });
            continue;
          }
          if (!(await validWorkItem(
            tx,
            actor.tenantId,
            candidate.workspaceId,
            candidate.projectId,
            candidate.workItemId,
          ))) {
            blockers.push({ recordId: candidate.recordId, code: 'WBS_WORK_ITEM_MAPPING_STALE' });
            continue;
          }
          const projectCurrency = await projectCostCurrency(tx, actor.tenantId, candidate.projectId);
          if (candidate.currency && candidate.currency !== projectCurrency) {
            blockers.push({
              recordId: candidate.recordId,
              code: 'PROJECT_CURRENCY_MISMATCH',
              details: { sourceCurrency: candidate.currency, projectCurrency },
            });
            continue;
          }
          const costCodeRows = candidate.costElement
            ? await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                SELECT id FROM cost_codes
                WHERE tenant_id = ${actor.tenantId}::uuid
                  AND workspace_id = ${candidate.workspaceId}::uuid
                  AND code = ${candidate.costElement}
                  AND is_active = true
                LIMIT 1
              `)
            : [];
          const costCodeId = costCodeRows[0]?.id ?? null;
          const existing = await findEntityLink(
            tx,
            actor.tenantId,
            connection.id,
            'SAP_PRE_PO_COMMITMENT',
            candidate.externalKey,
          );
          if (existing && existing.canonical_entity_type !== 'PROJECT_COMMITMENT') {
            blockers.push({ recordId: candidate.recordId, code: 'PRE_PO_COMMITMENT_LINK_CONFLICT' });
            continue;
          }

          let commitmentId: string;
          if (existing) {
            const updated = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
              UPDATE project_commitments
              SET workspace_id = ${candidate.workspaceId}::uuid,
                  project_object_id = ${candidate.projectId}::uuid,
                  work_item_object_id = ${candidate.workItemId}::uuid,
                  cost_code_id = ${costCodeId}::uuid,
                  description = ${candidate.description},
                  amount = ${candidate.amount},
                  released_amount = 0,
                  currency = ${projectCurrency},
                  status = 'OPEN',
                  source_type = 'SAP_IMPORT',
                  source_reference = ${candidate.externalKey},
                  committed_at = COALESCE(${dateTimeOrNull(candidate.postingDate)}, committed_at),
                  updated_at = CURRENT_TIMESTAMP
              WHERE id = ${existing.canonical_entity_id}::uuid
                AND tenant_id = ${actor.tenantId}::uuid
              RETURNING id
            `);
            if (!updated[0]) {
              blockers.push({ recordId: candidate.recordId, code: 'PRE_PO_COMMITMENT_LINK_STALE' });
              continue;
            }
            commitmentId = updated[0].id;
            counters.prePoUpdated += 1;
          } else {
            const inserted = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
              INSERT INTO project_commitments
                (tenant_id, workspace_id, project_object_id, work_item_object_id,
                 cost_code_id, supplier_id, description, amount, released_amount,
                 currency, status, source_type, source_reference, committed_at, notes, updated_at)
              VALUES
                (${actor.tenantId}::uuid, ${candidate.workspaceId}::uuid, ${candidate.projectId}::uuid,
                 ${candidate.workItemId}::uuid, ${costCodeId}::uuid, NULL,
                 ${candidate.description}, ${candidate.amount}, 0, ${projectCurrency}, 'OPEN',
                 'SAP_IMPORT', ${candidate.externalKey},
                 COALESCE(${dateTimeOrNull(candidate.postingDate)}, CURRENT_TIMESTAMP),
                 'Compromiso pre-Pedido sincronizado desde SAP; se cerrará al aparecer el Pedido.',
                 CURRENT_TIMESTAMP)
              RETURNING id
            `);
            commitmentId = inserted[0]!.id;
            counters.prePoInserted += 1;
          }

          await saveEntityLink(tx, {
            tenantId: actor.tenantId,
            connectionId: connection.id,
            sourceRecordId: candidate.recordId,
            externalType: 'SAP_PRE_PO_COMMITMENT',
            externalKey: candidate.externalKey,
            canonicalType: 'PROJECT_COMMITMENT',
            canonicalId: commitmentId,
            metadata: {
              source: 'SAP',
              canonicalSyncVersion: 'v1d3',
              wbsElement: candidate.wbsElement,
              projectId: candidate.projectId,
              representation: 'PRE_PO_ONLY',
            },
          });
          await tx.$executeRaw(Prisma.sql`
            UPDATE integration_import_records
            SET processing_status = 'APPLIED', updated_at = CURRENT_TIMESTAMP
            WHERE id = ${candidate.recordId}::uuid AND tenant_id = ${actor.tenantId}::uuid
          `);
        }

        for (const derived of plan.poDerivedCommitments) {
          const scope = await scopePurchaseOrderToProject(
            tx,
            actor.tenantId,
            connection.id,
            derived.poKey,
            derived.workspaceId,
            derived.projectId,
          );
          if (scope === 'missing') {
            blockers.push({ recordId: derived.recordId, code: 'CANONICAL_PURCHASE_ORDER_LINE_REQUIRED', details: { poKey: derived.poKey } });
            continue;
          }
          if (scope === 'conflict') {
            blockers.push({ recordId: derived.recordId, code: 'PURCHASE_ORDER_PROJECT_MAPPING_CONFLICT', details: { poKey: derived.poKey } });
            continue;
          }
          if (scope === 'updated') counters.purchaseOrdersScoped += 1;
          else counters.unchanged += 1;

          if (derived.supersededPrKey) {
            const closed = await closePrePoCommitment(
              tx,
              actor.tenantId,
              connection.id,
              derived.supersededPrKey,
            );
            if (closed === 'closed') counters.prePoClosed += 1;
            else if (closed === 'unchanged' || closed === 'missing') counters.unchanged += 1;
            else blockers.push({
              recordId: derived.recordId,
              code: 'PRE_PO_COMMITMENT_LINK_CONFLICT',
              details: { supersededPrKey: derived.supersededPrKey },
            });
          }

          await tx.$executeRaw(Prisma.sql`
            UPDATE integration_import_records
            SET processing_status = 'APPLIED', updated_at = CURRENT_TIMESTAMP
            WHERE id = ${derived.recordId}::uuid AND tenant_id = ${actor.tenantId}::uuid
          `);
        }

        await tx.auditLog.create({
          data: {
            tenantId: actor.tenantId,
            userId: actor.userId,
            action: 'SAP_FINANCIAL_GUARD_V1D3_APPLIED',
            resource: 'INTEGRATION_CONNECTION',
            resourceId: connection.id,
            correlationId: request.id,
            ipAddress: request.ip,
            details: toInputJson({
              counters,
              blockers: blockers.slice(0, 100),
              commitmentAuthority: 'PR_UNTIL_PO_THEN_PURCHASE_ORDER_LEDGER',
              actualCostCanonicalWriteEnabled: false,
            }),
          },
        });
        await tx.domainEvent.create({
          data: {
            tenantId: actor.tenantId,
            aggregateId: connection.id,
            eventType: 'bridata.integration.sap.financial-guard.v1d3.applied',
            payload: {
              connectionId: connection.id,
              counters,
              blockers: blockers.length,
              actorId: actor.userId,
            },
          },
        });

        return { kind: 'ok' as const, dryRun: false, plan, counters, blockers };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'sap_integration_connection_not_found' });
      if (result.kind === 'disconnected') return reply.code(409).send({ error: 'sap_integration_connection_disconnected' });
      return reply.send({
        version: 'v1d3',
        dryRun: result.dryRun,
        canonicalDatabase: 'BRIDATA_POSTGRESQL',
        commitmentCanonicalWriteEnabled: !result.dryRun,
        actualCostCanonicalWriteEnabled: false,
        commitmentAuthority: 'PR_UNTIL_PO_THEN_PURCHASE_ORDER_LEDGER',
        actualCostAuthorityPlannedForV1d4: 'SAP_PROJECT_ACTUAL_COSTS',
        summary: result.plan.summary,
        counters: result.counters,
        blockers: result.blockers,
        safeguards: {
          wbsProjectMappingRequired: true,
          poCommitmentNeverDuplicatedIntoProjectCommitment: true,
          prePoCommitmentClosedAfterPoScopeSucceeds: true,
          dataPepActualWritesDeferred: true,
          goodsReceiptAndDataPepDoubleCountStillBlocked: true,
          excelRuntimeDependency: false,
        },
      });
    },
  );
}
