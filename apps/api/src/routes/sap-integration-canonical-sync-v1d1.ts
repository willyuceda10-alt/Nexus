import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canManageWorkspace, isTenantAdministrator } from '../authorization.js';
import {
  buildCanonicalSyncPlanV1d1,
  derivePurchaseOrderStatusV1d1,
  type CanonicalSourceRecordV1d1,
} from '../domain/sap-canonical-sync-v1d1.js';
import { withTenant } from '../tenant-transaction.js';

const paramsSchema = z.object({ connectionId: z.string().uuid() });
const bodySchema = z.object({ workspaceId: z.string().uuid(), dryRun: z.boolean().default(true) });

type LatestRecordRow = {
  id: string;
  source_key: string;
  external_key: string | null;
  normalized_payload: Prisma.JsonValue | null;
};

type MaterialRow = { id: string; base_uom_id: string };
type UomRow = { id: string };
type SupplierRow = { id: string };
type HeaderRow = { id: string };
type LinkRow = { id: string; canonical_entity_id: string };

type SyncCounters = {
  materialsInserted: number;
  materialsUpdated: number;
  suppliersInserted: number;
  suppliersUpdated: number;
  requisitionsInserted: number;
  requisitionsUpdated: number;
  requisitionLinesInserted: number;
  requisitionLinesUpdated: number;
  purchaseOrdersInserted: number;
  purchaseOrdersUpdated: number;
  purchaseOrderLinesInserted: number;
  purchaseOrderLinesUpdated: number;
  unchanged: number;
  skippedServices: number;
  blockedMovements: number;
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

function numberValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function dateOnly(value: unknown): string | null {
  const raw = text(value);
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function currency(value: unknown): string {
  const raw = text(value)?.toUpperCase() ?? 'USD';
  return /^[A-Z]{3}$/.test(raw) ? raw : 'USD';
}

function emptyCounters(blockedMovements: number): SyncCounters {
  return {
    materialsInserted: 0,
    materialsUpdated: 0,
    suppliersInserted: 0,
    suppliersUpdated: 0,
    requisitionsInserted: 0,
    requisitionsUpdated: 0,
    requisitionLinesInserted: 0,
    requisitionLinesUpdated: 0,
    purchaseOrdersInserted: 0,
    purchaseOrdersUpdated: 0,
    purchaseOrderLinesInserted: 0,
    purchaseOrderLinesUpdated: 0,
    unchanged: 0,
    skippedServices: 0,
    blockedMovements,
  };
}

async function loadLatestRecords(
  tx: Prisma.TransactionClient,
  tenantId: string,
  connectionId: string,
): Promise<CanonicalSourceRecordV1d1[]> {
  const rows = await tx.$queryRaw<LatestRecordRow[]>(Prisma.sql`
    WITH latest_batches AS (
      SELECT id, source_id, source_key FROM (
        SELECT b.id,
               s.id AS source_id,
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

async function upsertUom(
  tx: Prisma.TransactionClient,
  tenantId: string,
  codeRaw: string,
): Promise<string> {
  const code = codeRaw.trim().toUpperCase().slice(0, 30) || 'UND';
  const rows = await tx.$queryRaw<UomRow[]>(Prisma.sql`
    INSERT INTO unit_of_measures (tenant_id, code, name, decimal_places, is_active, updated_at)
    VALUES (${tenantId}::uuid, ${code}, ${code}, 4, true, CURRENT_TIMESTAMP)
    ON CONFLICT (tenant_id, code)
    DO UPDATE SET is_active = true, updated_at = CURRENT_TIMESTAMP
    RETURNING id
  `);
  return rows[0]!.id;
}

async function ensureMaterial(
  tx: Prisma.TransactionClient,
  tenantId: string,
  workspaceId: string,
  actorUserId: string,
  code: string,
  description: string | null,
  uomCode: string,
  counters: SyncCounters,
): Promise<string> {
  const existing = await tx.$queryRaw<MaterialRow[]>(Prisma.sql`
    SELECT id, base_uom_id
    FROM material_masters
    WHERE tenant_id = ${tenantId}::uuid
      AND workspace_id = ${workspaceId}::uuid
      AND code = ${code}
    LIMIT 1
  `);
  const uomId = await upsertUom(tx, tenantId, uomCode);
  if (existing[0]) {
    await tx.$executeRaw(Prisma.sql`
      UPDATE material_masters
      SET base_uom_id = ${uomId}::uuid, is_active = true, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${existing[0].id}::uuid AND tenant_id = ${tenantId}::uuid
    `);
    counters.materialsUpdated += 1;
    return existing[0].id;
  }

  const definition = await tx.objectDefinition.findFirst({
    where: { tenantId, key: 'MATERIAL' },
    select: { id: true },
  });
  if (!definition) throw new Error('material_object_definition_missing');
  const object = await tx.nexusObject.create({
    data: {
      tenantId,
      workspaceId,
      objectDefinitionId: definition.id,
      objectTypeKey: 'MATERIAL',
      title: (description ?? `Material ${code}`).slice(0, 500),
      status: 'ACTIVE',
      priority: 'MEDIUM',
      progress: 0,
      ownerId: actorUserId,
      metadata: { source: 'SAP', sapMaterialCode: code },
    },
    select: { id: true },
  });
  const rows = await tx.$queryRaw<MaterialRow[]>(Prisma.sql`
    INSERT INTO material_masters
      (tenant_id, workspace_id, material_object_id, code, base_uom_id, unit_cost, currency, is_active, updated_at)
    VALUES
      (${tenantId}::uuid, ${workspaceId}::uuid, ${object.id}::uuid, ${code}, ${uomId}::uuid,
       0, 'USD', true, CURRENT_TIMESTAMP)
    RETURNING id, base_uom_id
  `);
  counters.materialsInserted += 1;
  return rows[0]!.id;
}

async function ensureSupplier(
  tx: Prisma.TransactionClient,
  tenantId: string,
  code: string,
  name: string,
  counters: SyncCounters,
): Promise<string> {
  const before = await tx.$queryRaw<SupplierRow[]>(Prisma.sql`
    SELECT id FROM suppliers WHERE tenant_id = ${tenantId}::uuid AND code = ${code} LIMIT 1
  `);
  const rows = await tx.$queryRaw<SupplierRow[]>(Prisma.sql`
    INSERT INTO suppliers (tenant_id, code, name, is_active, updated_at)
    VALUES (${tenantId}::uuid, ${code}, ${name}, true, CURRENT_TIMESTAMP)
    ON CONFLICT (tenant_id, code)
    DO UPDATE SET name = EXCLUDED.name, is_active = true, updated_at = CURRENT_TIMESTAMP
    RETURNING id
  `);
  if (before.length) counters.suppliersUpdated += 1;
  else counters.suppliersInserted += 1;
  return rows[0]!.id;
}

async function findLink(
  tx: Prisma.TransactionClient,
  tenantId: string,
  connectionId: string,
  externalType: string,
  externalKey: string,
): Promise<LinkRow | null> {
  const rows = await tx.$queryRaw<LinkRow[]>(Prisma.sql`
    SELECT id, canonical_entity_id
    FROM integration_entity_links
    WHERE tenant_id = ${tenantId}::uuid
      AND integration_connection_id = ${connectionId}::uuid
      AND external_entity_type = ${externalType}
      AND external_key = ${externalKey}
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function saveLink(
  tx: Prisma.TransactionClient,
  tenantId: string,
  connectionId: string,
  sourceRecordId: string,
  externalType: string,
  externalKey: string,
  canonicalType: string,
  canonicalId: string,
): Promise<void> {
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO integration_entity_links
      (tenant_id, integration_connection_id, source_record_id,
       external_entity_type, external_key, canonical_entity_type, canonical_entity_id,
       metadata, last_seen_at, updated_at)
    VALUES
      (${tenantId}::uuid, ${connectionId}::uuid, ${sourceRecordId}::uuid,
       ${externalType}, ${externalKey}, ${canonicalType}, ${canonicalId}::uuid,
       ${JSON.stringify({ source: 'SAP', canonicalSyncVersion: 'v1d1' })}::jsonb,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (tenant_id, integration_connection_id, external_entity_type, external_key)
    DO UPDATE SET source_record_id = EXCLUDED.source_record_id,
                  canonical_entity_type = EXCLUDED.canonical_entity_type,
                  canonical_entity_id = EXCLUDED.canonical_entity_id,
                  metadata = EXCLUDED.metadata,
                  last_seen_at = CURRENT_TIMESTAMP,
                  updated_at = CURRENT_TIMESTAMP
  `);
}

function groupByDocument(rows: CanonicalSourceRecordV1d1[], field: string): Map<string, CanonicalSourceRecordV1d1[]> {
  const grouped = new Map<string, CanonicalSourceRecordV1d1[]>();
  for (const row of rows) {
    const key = text(row.normalized[field]);
    if (!key) continue;
    const current = grouped.get(key) ?? [];
    current.push(row);
    grouped.set(key, current);
  }
  return grouped;
}

export async function sapIntegrationCanonicalSyncV1d1Routes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/v1/integrations/sap/connections/:connectionId/canonical-sync-v1d1',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      const body = bodySchema.safeParse(request.body ?? {});
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
        if (!(await canManageWorkspace(tx, actor, body.data.workspaceId))) return { kind: 'forbidden' as const };

        const records = await loadLatestRecords(tx, actor.tenantId, connection.id);
        const plan = buildCanonicalSyncPlanV1d1(records);
        const counters = emptyCounters(plan.summary.blockedMovements);
        const blockers: Array<{ recordId: string; code: string }> = plan.blockedMovements.map((item) => ({
          recordId: item.recordId,
          code: item.reason,
        }));

        if (body.data.dryRun) {
          return { kind: 'ok' as const, dryRun: true, plan, counters, blockers };
        }

        const materials = new Map<string, string>();
        for (const material of plan.materials) {
          materials.set(material.code, await ensureMaterial(
            tx,
            actor.tenantId,
            body.data.workspaceId,
            actor.userId,
            material.code,
            material.description,
            material.uom,
            counters,
          ));
        }

        for (const [number, lines] of groupByDocument(plan.requisitions, 'requisitionNumber')) {
          const requiredDates = lines.map((line) => dateOnly(line.normalized.releaseDate) ?? dateOnly(line.normalized.requisitionDate)).filter(Boolean) as string[];
          const status = lines.some((line) => text(line.normalized.purchaseOrderNumber)) ? 'CONVERTED' : 'SUBMITTED';
          const before = await tx.$queryRaw<HeaderRow[]>(Prisma.sql`
            SELECT id FROM purchase_requisitions
            WHERE tenant_id = ${actor.tenantId}::uuid AND workspace_id = ${body.data.workspaceId}::uuid AND number = ${number}
          `);
          const headers = await tx.$queryRaw<HeaderRow[]>(Prisma.sql`
            INSERT INTO purchase_requisitions
              (tenant_id, workspace_id, number, status, required_date, requested_by_user_id, notes, updated_at)
            VALUES
              (${actor.tenantId}::uuid, ${body.data.workspaceId}::uuid, ${number}, ${status},
               ${requiredDates.sort()[0] ?? null}::date, ${actor.userId}::uuid, 'Sincronizado desde SAP', CURRENT_TIMESTAMP)
            ON CONFLICT (tenant_id, workspace_id, number)
            DO UPDATE SET status = EXCLUDED.status,
                          required_date = COALESCE(EXCLUDED.required_date, purchase_requisitions.required_date),
                          updated_at = CURRENT_TIMESTAMP
            RETURNING id
          `);
          const headerId = headers[0]!.id;
          if (before.length) counters.requisitionsUpdated += 1;
          else counters.requisitionsInserted += 1;

          for (const line of lines) {
            const materialCode = text(line.normalized.materialCode)?.replace(/\.0+$/, '') ?? null;
            if (!materialCode) {
              counters.skippedServices += 1;
              blockers.push({ recordId: line.id, code: 'SERVICE_PROCUREMENT_CANONICAL_MODEL_PENDING' });
              continue;
            }
            const materialId = materials.get(materialCode);
            if (!materialId || !line.externalKey) continue;
            const uomId = await upsertUom(tx, actor.tenantId, text(line.normalized.uom) ?? 'UND');
            const qty = Math.max(0.0001, numberValue(line.normalized.requestedQuantity) ?? 1);
            const total = numberValue(line.normalized.totalValue) ?? 0;
            const unitCost = qty > 0 ? Math.max(0, total / qty) : 0;
            const link = await findLink(tx, actor.tenantId, connection.id, 'SAP_PURCHASE_REQUISITION_LINE', line.externalKey);
            let lineId: string;
            if (link) {
              await tx.$executeRaw(Prisma.sql`
                UPDATE purchase_requisition_lines
                SET requisition_id = ${headerId}::uuid,
                    material_id = ${materialId}::uuid,
                    uom_id = ${uomId}::uuid,
                    quantity = ${qty},
                    estimated_unit_cost = ${unitCost}
                WHERE id = ${link.canonical_entity_id}::uuid AND tenant_id = ${actor.tenantId}::uuid
              `);
              lineId = link.canonical_entity_id;
              counters.requisitionLinesUpdated += 1;
            } else {
              const inserted = await tx.$queryRaw<HeaderRow[]>(Prisma.sql`
                INSERT INTO purchase_requisition_lines
                  (tenant_id, requisition_id, material_id, uom_id, quantity, estimated_unit_cost)
                VALUES
                  (${actor.tenantId}::uuid, ${headerId}::uuid, ${materialId}::uuid, ${uomId}::uuid, ${qty}, ${unitCost})
                RETURNING id
              `);
              lineId = inserted[0]!.id;
              counters.requisitionLinesInserted += 1;
            }
            await saveLink(tx, actor.tenantId, connection.id, line.id,
              'SAP_PURCHASE_REQUISITION_LINE', line.externalKey, 'PURCHASE_REQUISITION_LINE', lineId);
            await tx.$executeRaw(Prisma.sql`
              UPDATE integration_import_records SET processing_status = 'APPLIED', updated_at = CURRENT_TIMESTAMP
              WHERE id = ${line.id}::uuid AND tenant_id = ${actor.tenantId}::uuid
            `);
          }
        }

        const supplierMap = new Map(plan.suppliers.map((supplier) => [supplier.name, supplier]));
        for (const [number, lines] of groupByDocument(plan.purchaseOrders, 'purchaseOrderNumber')) {
          const supplierRaw = lines.map((line) => text(line.normalized.supplierOrSupplyingPlant)).find(Boolean) ?? null;
          if (!supplierRaw) {
            for (const line of lines) blockers.push({ recordId: line.id, code: 'SUPPLIER_IDENTITY_MISSING' });
            continue;
          }
          const supplier = supplierMap.get(supplierRaw);
          if (!supplier) continue;
          const supplierId = await ensureSupplier(tx, actor.tenantId, supplier.code, supplier.name, counters);
          const status = derivePurchaseOrderStatusV1d1(lines);
          const orderDate = lines.map((line) => dateOnly(line.normalized.documentDate)).find(Boolean) ?? new Date().toISOString().slice(0, 10);
          const expectedDate = lines.map((line) => dateOnly(line.normalized.deliveryDate)).filter(Boolean).sort()[0] ?? null;
          const orderCurrency = currency(lines.map((line) => line.normalized.currency).find((value) => text(value)));
          const before = await tx.$queryRaw<HeaderRow[]>(Prisma.sql`
            SELECT id FROM purchase_orders
            WHERE tenant_id = ${actor.tenantId}::uuid AND workspace_id = ${body.data.workspaceId}::uuid AND number = ${number}
          `);
          const headers = await tx.$queryRaw<HeaderRow[]>(Prisma.sql`
            INSERT INTO purchase_orders
              (tenant_id, workspace_id, supplier_id, number, status, order_date, expected_date, currency, notes, updated_at)
            VALUES
              (${actor.tenantId}::uuid, ${body.data.workspaceId}::uuid, ${supplierId}::uuid, ${number}, ${status},
               ${orderDate}::date, ${expectedDate}::date, ${orderCurrency}, 'Sincronizado desde SAP', CURRENT_TIMESTAMP)
            ON CONFLICT (tenant_id, workspace_id, number)
            DO UPDATE SET supplier_id = EXCLUDED.supplier_id,
                          status = EXCLUDED.status,
                          order_date = EXCLUDED.order_date,
                          expected_date = EXCLUDED.expected_date,
                          currency = EXCLUDED.currency,
                          updated_at = CURRENT_TIMESTAMP
            RETURNING id
          `);
          const headerId = headers[0]!.id;
          if (before.length) counters.purchaseOrdersUpdated += 1;
          else counters.purchaseOrdersInserted += 1;

          for (const line of lines) {
            const materialCode = text(line.normalized.materialCode)?.replace(/\.0+$/, '') ?? null;
            if (!materialCode) {
              counters.skippedServices += 1;
              blockers.push({ recordId: line.id, code: 'SERVICE_PROCUREMENT_CANONICAL_MODEL_PENDING' });
              continue;
            }
            const materialId = materials.get(materialCode);
            if (!materialId || !line.externalKey) continue;
            const uomId = await upsertUom(tx, actor.tenantId, text(line.normalized.orderUom) ?? 'UND');
            const qty = Math.max(0.0001, numberValue(line.normalized.orderedQuantity) ?? 1);
            const unitCost = Math.max(0, numberValue(line.normalized.netPrice) ?? 0);
            const link = await findLink(tx, actor.tenantId, connection.id, 'SAP_PURCHASE_ORDER_LINE', line.externalKey);
            let lineId: string;
            if (link) {
              await tx.$executeRaw(Prisma.sql`
                UPDATE purchase_order_lines
                SET purchase_order_id = ${headerId}::uuid,
                    material_id = ${materialId}::uuid,
                    uom_id = ${uomId}::uuid,
                    quantity = ${qty},
                    unit_cost = ${unitCost},
                    expected_date = ${dateOnly(line.normalized.deliveryDate)}::date,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ${link.canonical_entity_id}::uuid AND tenant_id = ${actor.tenantId}::uuid
              `);
              lineId = link.canonical_entity_id;
              counters.purchaseOrderLinesUpdated += 1;
            } else {
              const inserted = await tx.$queryRaw<HeaderRow[]>(Prisma.sql`
                INSERT INTO purchase_order_lines
                  (tenant_id, purchase_order_id, material_id, uom_id, quantity, received_qty, unit_cost, expected_date, updated_at)
                VALUES
                  (${actor.tenantId}::uuid, ${headerId}::uuid, ${materialId}::uuid, ${uomId}::uuid,
                   ${qty}, 0, ${unitCost}, ${dateOnly(line.normalized.deliveryDate)}::date, CURRENT_TIMESTAMP)
                RETURNING id
              `);
              lineId = inserted[0]!.id;
              counters.purchaseOrderLinesInserted += 1;
            }
            await saveLink(tx, actor.tenantId, connection.id, line.id,
              'SAP_PURCHASE_ORDER_LINE', line.externalKey, 'PURCHASE_ORDER_LINE', lineId);
            await tx.$executeRaw(Prisma.sql`
              UPDATE integration_import_records SET processing_status = 'APPLIED', updated_at = CURRENT_TIMESTAMP
              WHERE id = ${line.id}::uuid AND tenant_id = ${actor.tenantId}::uuid
            `);
          }
        }

        await tx.auditLog.create({
          data: {
            tenantId: actor.tenantId,
            userId: actor.userId,
            action: 'SAP_CANONICAL_SYNC_V1D1_APPLIED',
            resource: 'INTEGRATION_CONNECTION',
            resourceId: connection.id,
            correlationId: request.id,
            ipAddress: request.ip,
            details: {
              workspaceId: body.data.workspaceId,
              counters,
              blockers: blockers.slice(0, 100),
              inventoryCanonicalWriteEnabled: false,
              financialCanonicalWriteEnabled: false,
            },
          },
        });
        await tx.domainEvent.create({
          data: {
            tenantId: actor.tenantId,
            aggregateId: connection.id,
            eventType: 'bridata.integration.sap.canonical-sync.v1d1.applied',
            payload: {
              connectionId: connection.id,
              workspaceId: body.data.workspaceId,
              counters,
              blockedMovements: plan.summary.blockedMovements,
              actorId: actor.userId,
            },
          },
        });

        return { kind: 'ok' as const, dryRun: false, plan, counters, blockers };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'sap_integration_connection_not_found' });
      if (result.kind === 'disconnected') return reply.code(409).send({ error: 'sap_integration_connection_disconnected' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_management_denied' });

      return reply.send({
        version: 'v1d1',
        dryRun: result.dryRun,
        canonicalDatabase: 'BRIDATA_POSTGRESQL',
        procurementCanonicalWriteEnabled: !result.dryRun,
        inventoryCanonicalWriteEnabled: false,
        financialCanonicalWriteEnabled: false,
        latestSnapshotPolicy: 'LATEST_SUCCEEDED_OR_PARTIAL_PER_LOGICAL_SOURCE',
        summary: result.plan.summary,
        counters: result.counters,
        blockers: result.blockers,
        safeguards: {
          excelRuntimeDependency: false,
          externalIdentityViaEntityLinks: true,
          servicesNotForcedIntoPhysicalInventory: true,
          materialMovementsRequireExactMaterialDocumentItemIdentity: true,
          commitmentsAndActualCostsBlockedUntilFinancialAntiDoubleCountLayer: true,
        },
      });
    },
  );
}
