import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canManageWorkspace, isTenantAdministrator } from '../authorization.js';
import {
  buildSapInventorySyncPlanV1d2,
  type SapInventoryMovementCandidateV1d2,
  type SapInventorySourceRecordV1d2,
} from '../domain/sap-inventory-sync-v1d2.js';
import { withTenant } from '../tenant-transaction.js';

const paramsSchema = z.object({ connectionId: z.string().uuid() });
const bodySchema = z.object({ workspaceId: z.string().uuid(), dryRun: z.boolean().default(true) });

type LatestRecordRow = {
  id: string;
  source_key: string;
  external_key: string | null;
  normalized_payload: Prisma.JsonValue | null;
};
type LinkRow = { canonical_entity_id: string; canonical_entity_type: string };
type MaterialRow = {
  id: string;
  base_uom_id: string;
  unit_cost: Prisma.Decimal | number | string;
};
type WarehouseRow = { id: string };
type PurchaseOrderLineRow = {
  id: string;
  purchase_order_id: string;
  material_id: string;
  uom_id: string;
  quantity: Prisma.Decimal | number | string;
  received_qty: Prisma.Decimal | number | string;
  unit_cost: Prisma.Decimal | number | string;
};
type HeaderRow = { id: string };
type QuantityRow = { quantity: Prisma.Decimal | number | string | null };
type PurchaseOrderTotalsRow = {
  ordered: Prisma.Decimal | number | string | null;
  received: Prisma.Decimal | number | string | null;
};

type ApplyCounters = {
  insertedMovements: number;
  unchangedMovements: number;
  blockedMovements: number;
  goodsReceiptsCreated: number;
  purchaseOrderLinesUpdated: number;
  warehousesCreatedOrReused: number;
};

type Blocker = { recordId: string; code: string; externalKey?: string };

type PreflightResult = {
  candidate: SapInventoryMovementCandidateV1d2;
  materialId: string;
  purchaseOrderLineId: string | null;
};

function jsonObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function numberOf(value: Prisma.Decimal | number | string | null | undefined): number {
  return value == null ? 0 : Number(value);
}

function occurredAt(postingDate: string | null): string {
  return postingDate && /^\d{4}-\d{2}-\d{2}$/.test(postingDate)
    ? `${postingDate}T00:00:00.000Z`
    : new Date().toISOString();
}

function postgresDomainCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as { code?: string; meta?: { code?: string; message?: string }; message?: string };
  if (candidate.code === 'P2010' && candidate.meta?.code === 'P0001') return candidate.meta.message ?? 'P0001';
  if (candidate.code === 'P0001') return candidate.message ?? 'P0001';
  return null;
}

async function loadLatestMovementRecords(
  tx: Prisma.TransactionClient,
  tenantId: string,
  connectionId: string,
): Promise<SapInventorySourceRecordV1d2[]> {
  const rows = await tx.$queryRaw<LatestRecordRow[]>(Prisma.sql`
    WITH latest_batch AS (
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
          AND s.source_key = 'SAP_MATERIAL_MOVEMENTS'
          AND s.is_active = true
          AND b.status IN ('SUCCEEDED','PARTIAL')
      ) ranked
      WHERE rn = 1
    )
    SELECT r.id, lb.source_key, r.external_key, r.normalized_payload
    FROM latest_batch lb
    JOIN integration_import_records r ON r.batch_id = lb.id
    WHERE r.tenant_id = ${tenantId}::uuid
      AND r.validation_status <> 'INVALID'
      AND r.processing_status <> 'FAILED'
    ORDER BY r.row_number
  `);
  return rows.map((row) => ({
    id: row.id,
    sourceKey: row.source_key,
    externalKey: row.external_key,
    normalized: jsonObject(row.normalized_payload),
  }));
}

async function findMaterial(
  tx: Prisma.TransactionClient,
  tenantId: string,
  workspaceId: string,
  materialCode: string,
): Promise<MaterialRow | null> {
  const rows = await tx.$queryRaw<MaterialRow[]>(Prisma.sql`
    SELECT id, base_uom_id, unit_cost
    FROM material_masters
    WHERE tenant_id = ${tenantId}::uuid
      AND workspace_id = ${workspaceId}::uuid
      AND code = ${materialCode}
      AND is_active = true
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function findExternalLink(
  tx: Prisma.TransactionClient,
  tenantId: string,
  connectionId: string,
  externalType: string,
  externalKey: string,
): Promise<LinkRow | null> {
  const rows = await tx.$queryRaw<LinkRow[]>(Prisma.sql`
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

async function findPurchaseOrderLine(
  tx: Prisma.TransactionClient,
  tenantId: string,
  connectionId: string,
  externalKey: string,
): Promise<PurchaseOrderLineRow | null> {
  const link = await findExternalLink(
    tx,
    tenantId,
    connectionId,
    'SAP_PURCHASE_ORDER_LINE',
    externalKey,
  );
  if (!link || link.canonical_entity_type !== 'PURCHASE_ORDER_LINE') return null;
  const rows = await tx.$queryRaw<PurchaseOrderLineRow[]>(Prisma.sql`
    SELECT id, purchase_order_id, material_id, uom_id, quantity, received_qty, unit_cost
    FROM purchase_order_lines
    WHERE tenant_id = ${tenantId}::uuid
      AND id = ${link.canonical_entity_id}::uuid
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function ensureWarehouse(
  tx: Prisma.TransactionClient,
  tenantId: string,
  workspaceId: string,
  candidate: SapInventoryMovementCandidateV1d2,
): Promise<string> {
  const rows = await tx.$queryRaw<WarehouseRow[]>(Prisma.sql`
    INSERT INTO warehouses (tenant_id, workspace_id, code, name, is_active, updated_at)
    VALUES (
      ${tenantId}::uuid,
      ${workspaceId}::uuid,
      ${candidate.warehouseCode},
      ${`SAP ${candidate.plant} / ${candidate.warehouse}`},
      true,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (tenant_id, workspace_id, code)
    DO UPDATE SET is_active = true, updated_at = CURRENT_TIMESTAMP
    RETURNING id
  `);
  return rows[0]!.id;
}

async function preflightCandidate(
  tx: Prisma.TransactionClient,
  tenantId: string,
  connectionId: string,
  workspaceId: string,
  candidate: SapInventoryMovementCandidateV1d2,
): Promise<{ eligible: PreflightResult | null; blocker: Blocker | null; unchanged: boolean }> {
  const existing = await findExternalLink(
    tx,
    tenantId,
    connectionId,
    'SAP_MATERIAL_DOCUMENT_ITEM',
    candidate.externalKey,
  );
  if (existing) return { eligible: null, blocker: null, unchanged: true };

  const material = await findMaterial(tx, tenantId, workspaceId, candidate.materialCode);
  if (!material) {
    return {
      eligible: null,
      unchanged: false,
      blocker: { recordId: candidate.recordId, externalKey: candidate.externalKey, code: 'MATERIAL_NOT_SYNCED_TO_BRIDATA' },
    };
  }

  let purchaseOrderLineId: string | null = null;
  if (candidate.canonicalMovementType === 'RECEIPT' || candidate.canonicalMovementType === 'ADJUSTMENT_OUT') {
    if (!candidate.purchaseOrderExternalKey) {
      return {
        eligible: null,
        unchanged: false,
        blocker: { recordId: candidate.recordId, externalKey: candidate.externalKey, code: 'PURCHASE_ORDER_IDENTITY_REQUIRED_FOR_RECEIPT' },
      };
    }
    const poLine = await findPurchaseOrderLine(tx, tenantId, connectionId, candidate.purchaseOrderExternalKey);
    if (!poLine) {
      return {
        eligible: null,
        unchanged: false,
        blocker: { recordId: candidate.recordId, externalKey: candidate.externalKey, code: 'PURCHASE_ORDER_LINE_NOT_SYNCED_TO_BRIDATA' },
      };
    }
    if (poLine.material_id !== material.id) {
      return {
        eligible: null,
        unchanged: false,
        blocker: { recordId: candidate.recordId, externalKey: candidate.externalKey, code: 'PURCHASE_ORDER_MATERIAL_MISMATCH' },
      };
    }
    purchaseOrderLineId = poLine.id;
  }

  return {
    eligible: { candidate, materialId: material.id, purchaseOrderLineId },
    blocker: null,
    unchanged: false,
  };
}

async function syncedReceiptQuantityForPoLine(
  tx: Prisma.TransactionClient,
  tenantId: string,
  poLineId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<QuantityRow[]>(Prisma.sql`
    SELECT COALESCE(SUM(
      CASE
        WHEN movement_type = 'RECEIPT' THEN quantity
        WHEN movement_type = 'ADJUSTMENT_OUT' THEN -quantity
        ELSE 0
      END
    ), 0) AS quantity
    FROM inventory_movements
    WHERE tenant_id = ${tenantId}::uuid
      AND reference_type = 'PURCHASE_ORDER_LINE'
      AND reference_id = ${poLineId}::uuid
  `);
  return numberOf(rows[0]?.quantity);
}

async function refreshPurchaseOrderReceiptState(
  tx: Prisma.TransactionClient,
  tenantId: string,
  poLineId: string,
): Promise<void> {
  const lines = await tx.$queryRaw<PurchaseOrderLineRow[]>(Prisma.sql`
    SELECT id, purchase_order_id, material_id, uom_id, quantity, received_qty, unit_cost
    FROM purchase_order_lines
    WHERE tenant_id = ${tenantId}::uuid AND id = ${poLineId}::uuid
    LIMIT 1
  `);
  const line = lines[0];
  if (!line) return;
  const received = await syncedReceiptQuantityForPoLine(tx, tenantId, poLineId);
  const clamped = Math.min(numberOf(line.quantity), Math.max(0, received));
  await tx.$executeRaw(Prisma.sql`
    UPDATE purchase_order_lines
    SET received_qty = ${clamped}, updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ${tenantId}::uuid AND id = ${poLineId}::uuid
  `);

  const totals = await tx.$queryRaw<PurchaseOrderTotalsRow[]>(Prisma.sql`
    SELECT COALESCE(SUM(quantity), 0) AS ordered,
           COALESCE(SUM(received_qty), 0) AS received
    FROM purchase_order_lines
    WHERE tenant_id = ${tenantId}::uuid
      AND purchase_order_id = ${line.purchase_order_id}::uuid
  `);
  const ordered = numberOf(totals[0]?.ordered);
  const totalReceived = numberOf(totals[0]?.received);
  const status = ordered > 0 && totalReceived >= ordered
    ? 'RECEIVED'
    : totalReceived > 0
      ? 'PARTIAL'
      : 'ORDERED';
  await tx.$executeRaw(Prisma.sql`
    UPDATE purchase_orders
    SET status = ${status}, updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ${tenantId}::uuid AND id = ${line.purchase_order_id}::uuid
  `);
}

async function applyCandidate(
  tenantId: string,
  connectionId: string,
  workspaceId: string,
  actorUserId: string,
  candidate: SapInventoryMovementCandidateV1d2,
): Promise<{ kind: 'inserted'; goodsReceiptCreated: boolean; poLineUpdated: boolean } | { kind: 'unchanged' } | { kind: 'blocked'; blocker: Blocker }> {
  try {
    return await withTenant(tenantId, async (tx) => {
      const preflight = await preflightCandidate(tx, tenantId, connectionId, workspaceId, candidate);
      if (preflight.unchanged) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE integration_entity_links
          SET source_record_id = ${candidate.recordId}::uuid,
              last_seen_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ${tenantId}::uuid
            AND integration_connection_id = ${connectionId}::uuid
            AND external_entity_type = 'SAP_MATERIAL_DOCUMENT_ITEM'
            AND external_key = ${candidate.externalKey}
        `);
        await tx.$executeRaw(Prisma.sql`
          UPDATE integration_import_records
          SET processing_status = 'APPLIED', updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ${tenantId}::uuid AND id = ${candidate.recordId}::uuid
        `);
        return { kind: 'unchanged' as const };
      }
      if (preflight.blocker || !preflight.eligible) {
        return { kind: 'blocked' as const, blocker: preflight.blocker! };
      }

      const material = await findMaterial(tx, tenantId, workspaceId, candidate.materialCode);
      if (!material) {
        return {
          kind: 'blocked' as const,
          blocker: { recordId: candidate.recordId, externalKey: candidate.externalKey, code: 'MATERIAL_NOT_SYNCED_TO_BRIDATA' },
        };
      }
      const warehouseId = await ensureWarehouse(tx, tenantId, workspaceId, candidate);
      const poLine = candidate.purchaseOrderExternalKey
        ? await findPurchaseOrderLine(tx, tenantId, connectionId, candidate.purchaseOrderExternalKey)
        : null;

      if (candidate.canonicalMovementType === 'ADJUSTMENT_OUT' && poLine) {
        const netReceived = await syncedReceiptQuantityForPoLine(tx, tenantId, poLine.id);
        if (candidate.quantity > netReceived) {
          return {
            kind: 'blocked' as const,
            blocker: {
              recordId: candidate.recordId,
              externalKey: candidate.externalKey,
              code: 'RECEIPT_REVERSAL_EXCEEDS_SYNCED_RECEIPTS',
            },
          };
        }
      }

      let goodsReceiptCreated = false;
      if (candidate.canonicalMovementType === 'RECEIPT') {
        const receiptNumber = `SAP-${candidate.fiscalYear}-${candidate.materialDocumentNumber}-${candidate.materialDocumentItem}`.slice(0, 80);
        const receiptRows = await tx.$queryRaw<HeaderRow[]>(Prisma.sql`
          INSERT INTO goods_receipts
            (tenant_id, workspace_id, warehouse_id, purchase_order_id, number, status,
             received_at, received_by_user_id, notes)
          VALUES
            (${tenantId}::uuid, ${workspaceId}::uuid, ${warehouseId}::uuid,
             ${poLine?.purchase_order_id ?? null}::uuid, ${receiptNumber}, 'POSTED',
             ${occurredAt(candidate.postingDate)}::timestamptz, ${actorUserId}::uuid,
             ${`SAP ${candidate.externalKey}`})
          ON CONFLICT (tenant_id, workspace_id, number)
          DO UPDATE SET warehouse_id = EXCLUDED.warehouse_id,
                        purchase_order_id = EXCLUDED.purchase_order_id,
                        received_at = EXCLUDED.received_at
          RETURNING id
        `);
        const receiptId = receiptRows[0]!.id;
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO goods_receipt_lines
            (tenant_id, goods_receipt_id, purchase_order_line_id, material_id, uom_id,
             quantity, unit_cost)
          VALUES
            (${tenantId}::uuid, ${receiptId}::uuid, ${poLine?.id ?? null}::uuid,
             ${material.id}::uuid, ${poLine?.uom_id ?? material.base_uom_id}::uuid,
             ${candidate.quantity}, ${numberOf(poLine?.unit_cost ?? material.unit_cost)})
        `);
        goodsReceiptCreated = true;
      }

      const movementRows = await tx.$queryRaw<HeaderRow[]>(Prisma.sql`
        INSERT INTO inventory_movements
          (tenant_id, workspace_id, warehouse_id, material_id, movement_type, quantity,
           unit_cost, occurred_at, reference_type, reference_id, created_by_user_id, notes)
        VALUES
          (${tenantId}::uuid, ${workspaceId}::uuid, ${warehouseId}::uuid, ${material.id}::uuid,
           ${candidate.canonicalMovementType}, ${candidate.quantity},
           ${numberOf(poLine?.unit_cost ?? material.unit_cost)}, ${occurredAt(candidate.postingDate)}::timestamptz,
           ${poLine ? 'PURCHASE_ORDER_LINE' : 'SAP_IMPORT_RECORD'},
           ${poLine?.id ?? candidate.recordId}::uuid,
           ${actorUserId}::uuid,
           ${`SAP ${candidate.externalKey}; BWART ${candidate.sapMovementType}; PEP ${candidate.wbsElement ?? '-'}`})
        RETURNING id
      `);
      const movementId = movementRows[0]!.id;

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO integration_entity_links
          (tenant_id, integration_connection_id, source_record_id, external_entity_type,
           external_key, canonical_entity_type, canonical_entity_id, metadata,
           last_seen_at, updated_at)
        VALUES
          (${tenantId}::uuid, ${connectionId}::uuid, ${candidate.recordId}::uuid,
           'SAP_MATERIAL_DOCUMENT_ITEM', ${candidate.externalKey},
           'INVENTORY_MOVEMENT', ${movementId}::uuid,
           ${JSON.stringify({ source: 'SAP', canonicalSyncVersion: 'v1d2', sapMovementType: candidate.sapMovementType })}::jsonb,
           CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `);

      await tx.$executeRaw(Prisma.sql`
        UPDATE integration_import_records
        SET processing_status = 'APPLIED', updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${tenantId}::uuid AND id = ${candidate.recordId}::uuid
      `);

      let poLineUpdated = false;
      if (poLine && (candidate.canonicalMovementType === 'RECEIPT' || candidate.canonicalMovementType === 'ADJUSTMENT_OUT')) {
        await refreshPurchaseOrderReceiptState(tx, tenantId, poLine.id);
        poLineUpdated = true;
      }

      return { kind: 'inserted' as const, goodsReceiptCreated, poLineUpdated };
    });
  } catch (error) {
    const domainCode = postgresDomainCode(error);
    if (domainCode) {
      return {
        kind: 'blocked',
        blocker: {
          recordId: candidate.recordId,
          externalKey: candidate.externalKey,
          code: domainCode.includes('insufficient')
            ? 'INSUFFICIENT_AVAILABLE_STOCK_FOR_SAP_MOVEMENT'
            : 'INVENTORY_DOMAIN_GUARD_REJECTED_SAP_MOVEMENT',
        },
      };
    }
    throw error;
  }
}

export async function sapIntegrationInventorySyncV1d2Routes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/v1/integrations/sap/connections/:connectionId/inventory-sync-v1d2',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      const body = bodySchema.safeParse(request.body ?? {});
      if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      if (!isTenantAdministrator(actor)) return reply.code(403).send({ error: 'tenant_admin_required' });

      const prepared = await withTenant(actor.tenantId, async (tx) => {
        const connection = await tx.integrationConnection.findFirst({
          where: { id: params.data.connectionId, tenantId: actor.tenantId, provider: 'SAP' },
          select: { id: true, status: true },
        });
        if (!connection) return { kind: 'not_found' as const };
        if (connection.status === 'DISCONNECTED') return { kind: 'disconnected' as const };
        if (!(await canManageWorkspace(tx, actor, body.data.workspaceId))) return { kind: 'forbidden' as const };

        const records = await loadLatestMovementRecords(tx, actor.tenantId, connection.id);
        const plan = buildSapInventorySyncPlanV1d2(records);
        const canonicalBlockers: Blocker[] = [];
        let unchanged = 0;
        let eligible = 0;
        for (const candidate of plan.candidates) {
          const preflight = await preflightCandidate(
            tx,
            actor.tenantId,
            connection.id,
            body.data.workspaceId,
            candidate,
          );
          if (preflight.unchanged) unchanged += 1;
          else if (preflight.blocker) canonicalBlockers.push(preflight.blocker);
          else if (preflight.eligible) eligible += 1;
        }
        return {
          kind: 'ok' as const,
          connectionId: connection.id,
          plan,
          canonicalBlockers,
          preflight: { eligible, unchanged },
        };
      });

      if (prepared.kind === 'not_found') return reply.code(404).send({ error: 'sap_integration_connection_not_found' });
      if (prepared.kind === 'disconnected') return reply.code(409).send({ error: 'sap_integration_connection_disconnected' });
      if (prepared.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_management_denied' });

      const structuralBlockers: Blocker[] = prepared.plan.blockers.map((item) => ({
        recordId: item.recordId,
        code: item.code,
      }));
      if (body.data.dryRun) {
        return reply.send({
          version: 'v1d2',
          dryRun: true,
          canonicalDatabase: 'BRIDATA_POSTGRESQL',
          inventoryCanonicalWriteEnabled: false,
          financialCanonicalWriteEnabled: false,
          summary: prepared.plan.summary,
          preflight: prepared.preflight,
          blockers: [...structuralBlockers, ...prepared.canonicalBlockers],
          safeguards: {
            materialDocumentItemIdentityRequired: true,
            duplicateProtectionViaIntegrationEntityLink: true,
            outboundInventoryGuardPreserved: true,
            procurementMustBeSyncedBeforeReceipt: true,
            financialWritesBlocked: true,
          },
        });
      }

      const counters: ApplyCounters = {
        insertedMovements: 0,
        unchangedMovements: 0,
        blockedMovements: structuralBlockers.length,
        goodsReceiptsCreated: 0,
        purchaseOrderLinesUpdated: 0,
        warehousesCreatedOrReused: 0,
      };
      const blockers: Blocker[] = [...structuralBlockers];

      for (const candidate of prepared.plan.candidates) {
        const result = await applyCandidate(
          actor.tenantId,
          prepared.connectionId,
          body.data.workspaceId,
          actor.userId,
          candidate,
        );
        if (result.kind === 'unchanged') {
          counters.unchangedMovements += 1;
          continue;
        }
        if (result.kind === 'blocked') {
          counters.blockedMovements += 1;
          blockers.push(result.blocker);
          continue;
        }
        counters.insertedMovements += 1;
        counters.warehousesCreatedOrReused += 1;
        if (result.goodsReceiptCreated) counters.goodsReceiptsCreated += 1;
        if (result.poLineUpdated) counters.purchaseOrderLinesUpdated += 1;
      }

      const fingerprint = createHash('sha256')
        .update(prepared.plan.candidates.map((candidate) => candidate.externalKey).sort().join('|') || 'empty')
        .digest('hex')
        .slice(0, 32);
      await withTenant(actor.tenantId, async (tx) => {
        await tx.auditLog.create({
          data: {
            tenantId: actor.tenantId,
            userId: actor.userId,
            action: 'SAP_INVENTORY_SYNC_V1D2_APPLIED',
            resource: 'INTEGRATION_CONNECTION',
            resourceId: prepared.connectionId,
            correlationId: request.id,
            ipAddress: request.ip,
            details: {
              workspaceId: body.data.workspaceId,
              planSummary: prepared.plan.summary,
              counters,
              blockers: blockers.slice(0, 100),
              inventoryCanonicalWriteEnabled: true,
              financialCanonicalWriteEnabled: false,
            },
          },
        });
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO domain_events
            (tenant_id, aggregate_id, event_type, payload, idempotency_key)
          VALUES
            (${actor.tenantId}::uuid, ${prepared.connectionId}::uuid,
             'bridata.integration.sap.inventory-sync.v1d2.applied',
             ${JSON.stringify({
               connectionId: prepared.connectionId,
               workspaceId: body.data.workspaceId,
               counters,
               actorId: actor.userId,
             })}::jsonb,
             ${`sap-inventory-sync-v1d2:${prepared.connectionId}:${fingerprint}`})
          ON CONFLICT (idempotency_key) DO NOTHING
        `);
      });

      return reply.send({
        version: 'v1d2',
        dryRun: false,
        canonicalDatabase: 'BRIDATA_POSTGRESQL',
        inventoryCanonicalWriteEnabled: true,
        financialCanonicalWriteEnabled: false,
        summary: prepared.plan.summary,
        counters,
        blockers,
        safeguards: {
          materialDocumentItemIdentityRequired: true,
          duplicateProtectionViaIntegrationEntityLink: true,
          repeatedApplyIsIdempotent: true,
          outboundInventoryGuardPreserved: true,
          purchaseOrderReceivedQuantityDerivedFromSyncedMovements: true,
          financialWritesBlocked: true,
        },
      });
    },
  );
}
