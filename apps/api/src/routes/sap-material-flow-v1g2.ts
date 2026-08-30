import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canAccessWorkspace } from '../authorization.js';
import { withTenant } from '../tenant-transaction.js';

const querySchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
});

type RequisitionRow = {
  line_id: string;
  material_id: string;
  material_code: string;
  material_title: string;
  uom_code: string;
  document_number: string;
  document_status: string;
  external_key: string;
  quantity: Prisma.Decimal | number | string;
  project_id: string | null;
  project_title: string | null;
  last_seen_at: Date | string;
};

type PurchaseOrderRow = {
  line_id: string;
  material_id: string;
  material_code: string;
  material_title: string;
  uom_code: string;
  document_number: string;
  document_status: string;
  external_key: string;
  quantity: Prisma.Decimal | number | string;
  received_qty: Prisma.Decimal | number | string;
  expected_date: Date | string | null;
  supplier_name: string;
  project_id: string | null;
  project_title: string | null;
  last_seen_at: Date | string;
};

type MovementRow = {
  material_id: string;
  material_code: string;
  material_title: string;
  uom_code: string;
  movement_type: string;
  quantity: Prisma.Decimal | number | string;
  occurred_at: Date | string;
  sap_movement_type: string | null;
  project_id: string | null;
  project_title: string | null;
  last_seen_at: Date | string;
};

type StockRow = {
  material_id: string;
  quantity: Prisma.Decimal | number | string | null;
};

type ProjectRow = { id: string; title: string };

type MaterialFlowItem = {
  key: string;
  materialId: string;
  materialCode: string;
  materialTitle: string;
  uomCode: string;
  projectId: string | null;
  projectTitle: string | null;
  requestedQty: number;
  orderedQty: number;
  receivedQty: number;
  outstandingQty: number;
  consumedQty: number;
  stockQty: number;
  state: 'AWAITING_ORDER' | 'ORDERED' | 'PARTIAL' | 'RECEIVED' | 'CONSUMED' | 'NO_ACTIVITY';
  risk: 'NONE' | 'WATCH' | 'LATE' | 'UNMAPPED';
  nextExpectedDate: string | null;
  lastSapActivityAt: string | null;
  requisitions: Array<{
    lineId: string;
    number: string;
    position: string | null;
    externalKey: string;
    quantity: number;
    status: string;
  }>;
  purchaseOrders: Array<{
    lineId: string;
    number: string;
    position: string | null;
    externalKey: string;
    supplierName: string;
    quantity: number;
    receivedQty: number;
    outstandingQty: number;
    status: string;
    expectedDate: string | null;
  }>;
};

function numberOf(value: Prisma.Decimal | number | string | null | undefined): number {
  if (value == null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dateOnly(value: Date | string | null | undefined): string | null {
  const normalized = iso(value);
  return normalized ? normalized.slice(0, 10) : null;
}

function sapPosition(externalKey: string): string | null {
  const parts = externalKey.split(':');
  return parts.length >= 3 ? parts.at(-1) ?? null : null;
}

function latest(...values: Array<string | null>): string | null {
  const valid = values.filter((value): value is string => Boolean(value));
  if (!valid.length) return null;
  return valid.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
}

function materialState(item: Pick<MaterialFlowItem, 'requestedQty' | 'orderedQty' | 'receivedQty' | 'consumedQty'>): MaterialFlowItem['state'] {
  if (item.orderedQty <= 0 && item.requestedQty > 0) return 'AWAITING_ORDER';
  if (item.orderedQty > 0 && item.receivedQty <= 0) return 'ORDERED';
  if (item.receivedQty > 0 && item.receivedQty + 0.000001 < item.orderedQty) return 'PARTIAL';
  if (item.receivedQty > 0 && item.consumedQty + 0.000001 >= item.receivedQty) return 'CONSUMED';
  if (item.receivedQty > 0) return 'RECEIVED';
  return 'NO_ACTIVITY';
}

function materialRisk(item: MaterialFlowItem, today: string): MaterialFlowItem['risk'] {
  if (!item.projectId) return 'UNMAPPED';
  if (item.outstandingQty > 0 && item.nextExpectedDate && item.nextExpectedDate < today) return 'LATE';
  if (item.requestedQty > item.orderedQty + 0.000001) return 'WATCH';
  return 'NONE';
}

export async function sapMaterialFlowV1g2Routes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/material-engine-v2/sap-flow-v1g2',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const query = querySchema.safeParse(request.query);
      if (!query.success) return reply.code(400).send({ error: 'validation_error', details: query.error.flatten() });
      const actor = request.actor!;
      const projectFilter = query.data.projectId ?? null;

      const result = await withTenant(actor.tenantId, async (tx) => {
        if (!(await canAccessWorkspace(tx, actor, query.data.workspaceId))) {
          return { kind: 'forbidden' as const };
        }

        let selectedProject: ProjectRow | null = null;
        if (projectFilter) {
          const projects = await tx.$queryRaw<ProjectRow[]>(Prisma.sql`
            SELECT id, title
            FROM nexus_objects
            WHERE tenant_id = ${actor.tenantId}::uuid
              AND workspace_id = ${query.data.workspaceId}::uuid
              AND id = ${projectFilter}::uuid
              AND object_type_key = 'PROJECT'
              AND deleted_at IS NULL
            LIMIT 1
          `);
          selectedProject = projects[0] ?? null;
          if (!selectedProject) return { kind: 'project_not_found' as const };
        }

        const projectPredicate = projectFilter
          ? Prisma.sql`AND COALESCE(po.project_object_id, wbs_map.canonical_entity_id) = ${projectFilter}::uuid`
          : Prisma.empty;
        const requisitionProjectPredicate = projectFilter
          ? Prisma.sql`AND wbs_map.canonical_entity_id = ${projectFilter}::uuid`
          : Prisma.empty;
        const movementProjectPredicate = projectFilter
          ? Prisma.sql`AND COALESCE(po.project_object_id, wbs_map.canonical_entity_id) = ${projectFilter}::uuid`
          : Prisma.empty;

        const requisitions = await tx.$queryRaw<RequisitionRow[]>(Prisma.sql`
          SELECT prl.id AS line_id,
                 prl.material_id,
                 mm.code AS material_code,
                 material_object.title AS material_title,
                 u.code AS uom_code,
                 pr.number AS document_number,
                 pr.status AS document_status,
                 sap_link.external_key,
                 prl.quantity,
                 wbs_map.canonical_entity_id AS project_id,
                 project.title AS project_title,
                 sap_link.last_seen_at
          FROM purchase_requisition_lines prl
          JOIN purchase_requisitions pr
            ON pr.id = prl.requisition_id
           AND pr.tenant_id = prl.tenant_id
          JOIN material_masters mm
            ON mm.id = prl.material_id
           AND mm.tenant_id = prl.tenant_id
          JOIN nexus_objects material_object ON material_object.id = mm.material_object_id
          JOIN unit_of_measures u ON u.id = prl.uom_id
          JOIN integration_entity_links sap_link
            ON sap_link.tenant_id = prl.tenant_id
           AND sap_link.canonical_entity_type = 'PURCHASE_REQUISITION_LINE'
           AND sap_link.canonical_entity_id = prl.id
           AND sap_link.external_entity_type = 'SAP_PURCHASE_REQUISITION_LINE'
          LEFT JOIN integration_import_records source_record
            ON source_record.id = sap_link.source_record_id
           AND source_record.tenant_id = sap_link.tenant_id
          LEFT JOIN integration_entity_links wbs_map
            ON wbs_map.tenant_id = sap_link.tenant_id
           AND wbs_map.integration_connection_id = sap_link.integration_connection_id
           AND wbs_map.external_entity_type = 'SAP_WBS_ELEMENT'
           AND wbs_map.canonical_entity_type = 'PROJECT_OBJECT'
           AND UPPER(wbs_map.external_key) = UPPER('WBS:' || COALESCE(source_record.normalized_payload->>'wbsElement', ''))
          LEFT JOIN nexus_objects project
            ON project.id = wbs_map.canonical_entity_id
           AND project.tenant_id = sap_link.tenant_id
          WHERE prl.tenant_id = ${actor.tenantId}::uuid
            AND pr.workspace_id = ${query.data.workspaceId}::uuid
            ${requisitionProjectPredicate}
          ORDER BY material_object.title, pr.number, sap_link.external_key
        `);

        const purchaseOrders = await tx.$queryRaw<PurchaseOrderRow[]>(Prisma.sql`
          SELECT pol.id AS line_id,
                 pol.material_id,
                 mm.code AS material_code,
                 material_object.title AS material_title,
                 u.code AS uom_code,
                 po.number AS document_number,
                 po.status AS document_status,
                 sap_link.external_key,
                 pol.quantity,
                 pol.received_qty,
                 COALESCE(pol.expected_date, po.expected_date) AS expected_date,
                 supplier.name AS supplier_name,
                 COALESCE(po.project_object_id, wbs_map.canonical_entity_id) AS project_id,
                 project.title AS project_title,
                 sap_link.last_seen_at
          FROM purchase_order_lines pol
          JOIN purchase_orders po
            ON po.id = pol.purchase_order_id
           AND po.tenant_id = pol.tenant_id
          JOIN suppliers supplier ON supplier.id = po.supplier_id
          JOIN material_masters mm
            ON mm.id = pol.material_id
           AND mm.tenant_id = pol.tenant_id
          JOIN nexus_objects material_object ON material_object.id = mm.material_object_id
          JOIN unit_of_measures u ON u.id = pol.uom_id
          JOIN integration_entity_links sap_link
            ON sap_link.tenant_id = pol.tenant_id
           AND sap_link.canonical_entity_type = 'PURCHASE_ORDER_LINE'
           AND sap_link.canonical_entity_id = pol.id
           AND sap_link.external_entity_type = 'SAP_PURCHASE_ORDER_LINE'
          LEFT JOIN integration_import_records source_record
            ON source_record.id = sap_link.source_record_id
           AND source_record.tenant_id = sap_link.tenant_id
          LEFT JOIN integration_entity_links wbs_map
            ON wbs_map.tenant_id = sap_link.tenant_id
           AND wbs_map.integration_connection_id = sap_link.integration_connection_id
           AND wbs_map.external_entity_type = 'SAP_WBS_ELEMENT'
           AND wbs_map.canonical_entity_type = 'PROJECT_OBJECT'
           AND UPPER(wbs_map.external_key) = UPPER('WBS:' || COALESCE(source_record.normalized_payload->>'wbsElement', ''))
          LEFT JOIN nexus_objects project
            ON project.id = COALESCE(po.project_object_id, wbs_map.canonical_entity_id)
           AND project.tenant_id = sap_link.tenant_id
          WHERE pol.tenant_id = ${actor.tenantId}::uuid
            AND po.workspace_id = ${query.data.workspaceId}::uuid
            ${projectPredicate}
          ORDER BY material_object.title, po.number, sap_link.external_key
        `);

        const movements = await tx.$queryRaw<MovementRow[]>(Prisma.sql`
          SELECT movement.material_id,
                 mm.code AS material_code,
                 material_object.title AS material_title,
                 u.code AS uom_code,
                 movement.movement_type,
                 movement.quantity,
                 movement.occurred_at,
                 sap_link.metadata->>'sapMovementType' AS sap_movement_type,
                 COALESCE(po.project_object_id, wbs_map.canonical_entity_id) AS project_id,
                 project.title AS project_title,
                 sap_link.last_seen_at
          FROM inventory_movements movement
          JOIN material_masters mm
            ON mm.id = movement.material_id
           AND mm.tenant_id = movement.tenant_id
          JOIN nexus_objects material_object ON material_object.id = mm.material_object_id
          JOIN unit_of_measures u ON u.id = mm.base_uom_id
          JOIN integration_entity_links sap_link
            ON sap_link.tenant_id = movement.tenant_id
           AND sap_link.canonical_entity_type = 'INVENTORY_MOVEMENT'
           AND sap_link.canonical_entity_id = movement.id
           AND sap_link.external_entity_type = 'SAP_MATERIAL_DOCUMENT_ITEM'
          LEFT JOIN integration_import_records source_record
            ON source_record.id = sap_link.source_record_id
           AND source_record.tenant_id = sap_link.tenant_id
          LEFT JOIN integration_entity_links wbs_map
            ON wbs_map.tenant_id = sap_link.tenant_id
           AND wbs_map.integration_connection_id = sap_link.integration_connection_id
           AND wbs_map.external_entity_type = 'SAP_WBS_ELEMENT'
           AND wbs_map.canonical_entity_type = 'PROJECT_OBJECT'
           AND UPPER(wbs_map.external_key) = UPPER('WBS:' || COALESCE(source_record.normalized_payload->>'wbsElement', ''))
          LEFT JOIN purchase_order_lines pol
            ON movement.reference_type = 'PURCHASE_ORDER_LINE'
           AND pol.id = movement.reference_id
           AND pol.tenant_id = movement.tenant_id
          LEFT JOIN purchase_orders po
            ON po.id = pol.purchase_order_id
           AND po.tenant_id = movement.tenant_id
          LEFT JOIN nexus_objects project
            ON project.id = COALESCE(po.project_object_id, wbs_map.canonical_entity_id)
           AND project.tenant_id = movement.tenant_id
          WHERE movement.tenant_id = ${actor.tenantId}::uuid
            AND movement.workspace_id = ${query.data.workspaceId}::uuid
            AND sap_link.metadata->>'sapMovementType' IN ('101','102','221','222')
            ${movementProjectPredicate}
          ORDER BY movement.occurred_at
        `);

        const stock = await tx.$queryRaw<StockRow[]>(Prisma.sql`
          SELECT material_id,
                 COALESCE(SUM(CASE
                   WHEN movement_type IN ('RECEIPT','TRANSFER_IN','ADJUSTMENT_IN') THEN quantity
                   ELSE -quantity
                 END), 0) AS quantity
          FROM inventory_movements
          WHERE tenant_id = ${actor.tenantId}::uuid
            AND workspace_id = ${query.data.workspaceId}::uuid
          GROUP BY material_id
        `);

        return {
          kind: 'ok' as const,
          selectedProject,
          requisitions,
          purchaseOrders,
          movements,
          stock,
        };
      });

      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });
      if (result.kind === 'project_not_found') return reply.code(404).send({ error: 'project_not_found' });

      const stockByMaterial = new Map(result.stock.map((row) => [row.material_id, numberOf(row.quantity)]));
      const items = new Map<string, MaterialFlowItem>();

      const ensureItem = (input: {
        materialId: string;
        materialCode: string;
        materialTitle: string;
        uomCode: string;
        projectId: string | null;
        projectTitle: string | null;
      }): MaterialFlowItem => {
        const key = `${input.materialId}:${input.projectId ?? 'UNMAPPED'}`;
        const existing = items.get(key);
        if (existing) return existing;
        const created: MaterialFlowItem = {
          key,
          ...input,
          requestedQty: 0,
          orderedQty: 0,
          receivedQty: 0,
          outstandingQty: 0,
          consumedQty: 0,
          stockQty: stockByMaterial.get(input.materialId) ?? 0,
          state: 'NO_ACTIVITY',
          risk: input.projectId ? 'NONE' : 'UNMAPPED',
          nextExpectedDate: null,
          lastSapActivityAt: null,
          requisitions: [],
          purchaseOrders: [],
        };
        items.set(key, created);
        return created;
      };

      for (const row of result.requisitions) {
        const item = ensureItem({
          materialId: row.material_id,
          materialCode: row.material_code,
          materialTitle: row.material_title,
          uomCode: row.uom_code,
          projectId: row.project_id,
          projectTitle: row.project_title,
        });
        const quantity = numberOf(row.quantity);
        item.requestedQty += quantity;
        item.lastSapActivityAt = latest(item.lastSapActivityAt, iso(row.last_seen_at));
        item.requisitions.push({
          lineId: row.line_id,
          number: row.document_number,
          position: sapPosition(row.external_key),
          externalKey: row.external_key,
          quantity,
          status: row.document_status,
        });
      }

      for (const row of result.purchaseOrders) {
        const item = ensureItem({
          materialId: row.material_id,
          materialCode: row.material_code,
          materialTitle: row.material_title,
          uomCode: row.uom_code,
          projectId: row.project_id,
          projectTitle: row.project_title,
        });
        const quantity = numberOf(row.quantity);
        const received = Math.min(quantity, Math.max(0, numberOf(row.received_qty)));
        const outstanding = Math.max(0, quantity - received);
        item.orderedQty += quantity;
        item.receivedQty += received;
        item.outstandingQty += outstanding;
        const expectedDate = dateOnly(row.expected_date);
        if (outstanding > 0 && expectedDate && (!item.nextExpectedDate || expectedDate < item.nextExpectedDate)) {
          item.nextExpectedDate = expectedDate;
        }
        item.lastSapActivityAt = latest(item.lastSapActivityAt, iso(row.last_seen_at));
        item.purchaseOrders.push({
          lineId: row.line_id,
          number: row.document_number,
          position: sapPosition(row.external_key),
          externalKey: row.external_key,
          supplierName: row.supplier_name,
          quantity,
          receivedQty: received,
          outstandingQty: outstanding,
          status: row.document_status,
          expectedDate,
        });
      }

      for (const row of result.movements) {
        const item = ensureItem({
          materialId: row.material_id,
          materialCode: row.material_code,
          materialTitle: row.material_title,
          uomCode: row.uom_code,
          projectId: row.project_id,
          projectTitle: row.project_title,
        });
        const quantity = numberOf(row.quantity);
        if (row.sap_movement_type === '221') item.consumedQty += quantity;
        if (row.sap_movement_type === '222') item.consumedQty -= quantity;
        item.consumedQty = Math.max(0, item.consumedQty);
        item.lastSapActivityAt = latest(item.lastSapActivityAt, iso(row.last_seen_at), iso(row.occurred_at));
      }

      const today = new Date().toISOString().slice(0, 10);
      const materialFlows = [...items.values()].map((item) => {
        item.state = materialState(item);
        item.risk = materialRisk(item, today);
        item.requisitions.sort((a, b) => `${a.number}:${a.position ?? ''}`.localeCompare(`${b.number}:${b.position ?? ''}`));
        item.purchaseOrders.sort((a, b) => `${a.number}:${a.position ?? ''}`.localeCompare(`${b.number}:${b.position ?? ''}`));
        return item;
      }).sort((a, b) => {
        const project = (a.projectTitle ?? '').localeCompare(b.projectTitle ?? '');
        return project || a.materialTitle.localeCompare(b.materialTitle) || a.materialCode.localeCompare(b.materialCode);
      });

      const uniqueStock = new Map<string, number>();
      for (const item of materialFlows) uniqueStock.set(item.materialId, item.stockQty);

      return reply.send({
        version: 'v1g2',
        canonicalDatabase: 'BRIDATA_POSTGRESQL',
        excelRuntimeDependency: false,
        workspaceId: query.data.workspaceId,
        projectId: result.selectedProject?.id ?? null,
        projectTitle: result.selectedProject?.title ?? null,
        generatedAt: new Date().toISOString(),
        summary: {
          rowCount: materialFlows.length,
          materialCount: new Set(materialFlows.map((item) => item.materialId)).size,
          requestedQty: materialFlows.reduce((sum, item) => sum + item.requestedQty, 0),
          orderedQty: materialFlows.reduce((sum, item) => sum + item.orderedQty, 0),
          receivedQty: materialFlows.reduce((sum, item) => sum + item.receivedQty, 0),
          outstandingQty: materialFlows.reduce((sum, item) => sum + item.outstandingQty, 0),
          consumedQty: materialFlows.reduce((sum, item) => sum + item.consumedQty, 0),
          stockQty: [...uniqueStock.values()].reduce((sum, quantity) => sum + quantity, 0),
          lateCount: materialFlows.filter((item) => item.risk === 'LATE').length,
          attentionCount: materialFlows.filter((item) => item.risk !== 'NONE').length,
          unmappedCount: materialFlows.filter((item) => item.risk === 'UNMAPPED').length,
        },
        materials: materialFlows,
        rules: {
          porLlegarDerived: 'PURCHASE_ORDER_QUANTITY_MINUS_RECEIVED_QTY',
          receivedDerivedFromInventoryLedger: true,
          consumedDerivedFromSap221Net222: true,
          stockDerivedFromCanonicalInventoryLedger: true,
          sapIdentityFromIntegrationEntityLinks: true,
        },
      });
    },
  );
}
