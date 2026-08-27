import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canAccessWorkspace } from '../authorization.js';
import { calculateMaterialAvailabilityV2 } from '../domain/material-inventory-v2.js';
import { withTenant } from '../tenant-transaction.js';

const querySchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

type RequirementOverviewRow = {
  id: string;
  project_object_id: string;
  project_title: string;
  work_item_object_id: string | null;
  work_item_title: string | null;
  wbs_code: string | null;
  material_id: string;
  material_object_id: string;
  material_code: string;
  material_title: string;
  uom_code: string;
  preferred_warehouse_id: string | null;
  warehouse_name: string | null;
  required_qty: Prisma.Decimal | number | string;
  required_date: Date | string;
  status: string;
  priority: string;
  notes: string | null;
};
type QuantityRow = { quantity: Prisma.Decimal | number | string | null };
type SupplyRow = {
  quantity: Prisma.Decimal | number | string;
  expected_date: Date | string | null;
  purchase_order_id: string;
  purchase_order_number: string;
};
type StockRow = {
  material_id: string;
  material_code: string;
  material_title: string;
  warehouse_id: string;
  warehouse_code: string;
  warehouse_name: string;
  on_hand: Prisma.Decimal | number | string;
  reserved: Prisma.Decimal | number | string;
};

function numberOf(value: Prisma.Decimal | number | string | null): number {
  return value == null ? 0 : Number(value);
}

function dateOnly(value: Date | string | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export async function materialOverviewV2Routes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/material-engine-v2/overview',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const query = querySchema.safeParse(request.query);
      if (!query.success) return reply.code(400).send({ error: 'validation_error', details: query.error.flatten() });
      const actor = request.actor!;
      const asOf = query.data.asOf ?? new Date().toISOString().slice(0, 10);

      const result = await withTenant(actor.tenantId, async (tx) => {
        if (!(await canAccessWorkspace(tx, actor, query.data.workspaceId))) {
          return { kind: 'forbidden' as const };
        }

        const requirements = query.data.projectId
          ? await tx.$queryRaw<RequirementOverviewRow[]>(Prisma.sql`
              SELECT mr.id, mr.project_object_id, p.title AS project_title,
                     mr.work_item_object_id, wi.title AS work_item_title, wis.wbs_code,
                     mr.material_id, mm.material_object_id, mm.code AS material_code,
                     mo.title AS material_title, u.code AS uom_code,
                     mr.preferred_warehouse_id, wh.name AS warehouse_name,
                     mr.required_qty, mr.required_date, mr.status, mr.priority, mr.notes
              FROM material_requirements mr
              JOIN nexus_objects p ON p.id = mr.project_object_id
              JOIN material_masters mm ON mm.id = mr.material_id
              JOIN nexus_objects mo ON mo.id = mm.material_object_id
              JOIN unit_of_measures u ON u.id = mm.base_uom_id
              LEFT JOIN nexus_objects wi ON wi.id = mr.work_item_object_id
              LEFT JOIN work_item_schedules wis ON wis.object_id = mr.work_item_object_id
              LEFT JOIN warehouses wh ON wh.id = mr.preferred_warehouse_id
              WHERE mr.tenant_id = ${actor.tenantId}::uuid
                AND mr.workspace_id = ${query.data.workspaceId}::uuid
                AND mr.project_object_id = ${query.data.projectId}::uuid
                AND mr.status <> 'CANCELLED'
              ORDER BY mr.required_date, mr.priority DESC, mr.created_at
            `)
          : await tx.$queryRaw<RequirementOverviewRow[]>(Prisma.sql`
              SELECT mr.id, mr.project_object_id, p.title AS project_title,
                     mr.work_item_object_id, wi.title AS work_item_title, wis.wbs_code,
                     mr.material_id, mm.material_object_id, mm.code AS material_code,
                     mo.title AS material_title, u.code AS uom_code,
                     mr.preferred_warehouse_id, wh.name AS warehouse_name,
                     mr.required_qty, mr.required_date, mr.status, mr.priority, mr.notes
              FROM material_requirements mr
              JOIN nexus_objects p ON p.id = mr.project_object_id
              JOIN material_masters mm ON mm.id = mr.material_id
              JOIN nexus_objects mo ON mo.id = mm.material_object_id
              JOIN unit_of_measures u ON u.id = mm.base_uom_id
              LEFT JOIN nexus_objects wi ON wi.id = mr.work_item_object_id
              LEFT JOIN work_item_schedules wis ON wis.object_id = mr.work_item_object_id
              LEFT JOIN warehouses wh ON wh.id = mr.preferred_warehouse_id
              WHERE mr.tenant_id = ${actor.tenantId}::uuid
                AND mr.workspace_id = ${query.data.workspaceId}::uuid
                AND mr.status <> 'CANCELLED'
              ORDER BY mr.required_date, mr.priority DESC, mr.created_at
            `);

        const items = [] as Array<Record<string, unknown>>;
        for (const requirement of requirements) {
          const onHandRows = requirement.preferred_warehouse_id
            ? await tx.$queryRaw<QuantityRow[]>(Prisma.sql`
                SELECT COALESCE(SUM(
                  CASE WHEN movement_type IN ('RECEIPT','TRANSFER_IN','ADJUSTMENT_IN')
                       THEN quantity ELSE -quantity END
                ), 0) AS quantity
                FROM inventory_movements
                WHERE tenant_id = ${actor.tenantId}::uuid
                  AND workspace_id = ${query.data.workspaceId}::uuid
                  AND material_id = ${requirement.material_id}::uuid
                  AND warehouse_id = ${requirement.preferred_warehouse_id}::uuid
              `)
            : await tx.$queryRaw<QuantityRow[]>(Prisma.sql`
                SELECT COALESCE(SUM(
                  CASE WHEN movement_type IN ('RECEIPT','TRANSFER_IN','ADJUSTMENT_IN')
                       THEN quantity ELSE -quantity END
                ), 0) AS quantity
                FROM inventory_movements
                WHERE tenant_id = ${actor.tenantId}::uuid
                  AND workspace_id = ${query.data.workspaceId}::uuid
                  AND material_id = ${requirement.material_id}::uuid
              `);

          const ownReservationRows = requirement.preferred_warehouse_id
            ? await tx.$queryRaw<QuantityRow[]>(Prisma.sql`
                SELECT COALESCE(SUM(quantity), 0) AS quantity
                FROM stock_reservations
                WHERE tenant_id = ${actor.tenantId}::uuid
                  AND requirement_id = ${requirement.id}::uuid
                  AND material_id = ${requirement.material_id}::uuid
                  AND warehouse_id = ${requirement.preferred_warehouse_id}::uuid
                  AND status = 'OPEN'
              `)
            : await tx.$queryRaw<QuantityRow[]>(Prisma.sql`
                SELECT COALESCE(SUM(quantity), 0) AS quantity
                FROM stock_reservations
                WHERE tenant_id = ${actor.tenantId}::uuid
                  AND requirement_id = ${requirement.id}::uuid
                  AND material_id = ${requirement.material_id}::uuid
                  AND status = 'OPEN'
              `);

          const otherReservationRows = requirement.preferred_warehouse_id
            ? await tx.$queryRaw<QuantityRow[]>(Prisma.sql`
                SELECT COALESCE(SUM(quantity), 0) AS quantity
                FROM stock_reservations
                WHERE tenant_id = ${actor.tenantId}::uuid
                  AND requirement_id <> ${requirement.id}::uuid
                  AND material_id = ${requirement.material_id}::uuid
                  AND warehouse_id = ${requirement.preferred_warehouse_id}::uuid
                  AND status = 'OPEN'
              `)
            : await tx.$queryRaw<QuantityRow[]>(Prisma.sql`
                SELECT COALESCE(SUM(sr.quantity), 0) AS quantity
                FROM stock_reservations sr
                JOIN warehouses wh ON wh.id = sr.warehouse_id
                WHERE sr.tenant_id = ${actor.tenantId}::uuid
                  AND sr.requirement_id <> ${requirement.id}::uuid
                  AND sr.material_id = ${requirement.material_id}::uuid
                  AND sr.status = 'OPEN'
                  AND wh.workspace_id = ${query.data.workspaceId}::uuid
              `);

          const issuedRows = await tx.$queryRaw<QuantityRow[]>(Prisma.sql`
            SELECT COALESCE(SUM(quantity), 0) AS quantity
            FROM inventory_movements
            WHERE tenant_id = ${actor.tenantId}::uuid
              AND requirement_id = ${requirement.id}::uuid
              AND movement_type = 'ISSUE'
          `);

          const supply = await tx.$queryRaw<SupplyRow[]>(Prisma.sql`
            SELECT (pol.quantity - pol.received_qty) AS quantity,
                   COALESCE(pol.expected_date, po.expected_date) AS expected_date,
                   po.id AS purchase_order_id, po.number AS purchase_order_number
            FROM purchase_order_lines pol
            JOIN purchase_orders po ON po.id = pol.purchase_order_id
            WHERE pol.tenant_id = ${actor.tenantId}::uuid
              AND pol.requirement_id = ${requirement.id}::uuid
              AND po.status IN ('APPROVED','ORDERED','PARTIAL')
              AND pol.quantity > pol.received_qty
            ORDER BY COALESCE(pol.expected_date, po.expected_date) NULLS LAST, po.created_at
          `);

          const availability = calculateMaterialAvailabilityV2({
            requiredQty: numberOf(requirement.required_qty),
            issuedQty: numberOf(issuedRows[0]?.quantity ?? 0),
            onHandQty: Math.max(0, numberOf(onHandRows[0]?.quantity ?? 0)),
            ownReservedQty: numberOf(ownReservationRows[0]?.quantity ?? 0),
            otherReservedQty: numberOf(otherReservationRows[0]?.quantity ?? 0),
            requiredDate: dateOnly(requirement.required_date)!,
            today: asOf,
            openPurchaseSupply: supply.map((row) => ({
              quantity: numberOf(row.quantity),
              expectedDate: dateOnly(row.expected_date),
            })),
          });

          items.push({
            id: requirement.id,
            projectId: requirement.project_object_id,
            projectTitle: requirement.project_title,
            workItemId: requirement.work_item_object_id,
            workItemTitle: requirement.work_item_title,
            wbsCode: requirement.wbs_code,
            materialId: requirement.material_id,
            materialObjectId: requirement.material_object_id,
            materialCode: requirement.material_code,
            materialTitle: requirement.material_title,
            uomCode: requirement.uom_code,
            preferredWarehouseId: requirement.preferred_warehouse_id,
            warehouseName: requirement.warehouse_name,
            priority: requirement.priority,
            status: requirement.status,
            notes: requirement.notes,
            requiredQty: numberOf(requirement.required_qty),
            issuedQty: numberOf(issuedRows[0]?.quantity ?? 0),
            purchaseOrders: supply.map((row) => ({
              id: row.purchase_order_id,
              number: row.purchase_order_number,
              outstandingQty: numberOf(row.quantity),
              expectedDate: dateOnly(row.expected_date),
            })),
            ...availability,
          });
        }

        const stock = await tx.$queryRaw<StockRow[]>(Prisma.sql`
          SELECT mm.id AS material_id, mm.code AS material_code, no.title AS material_title,
                 wh.id AS warehouse_id, wh.code AS warehouse_code, wh.name AS warehouse_name,
                 COALESCE(SUM(CASE
                   WHEN im.movement_type IN ('RECEIPT','TRANSFER_IN','ADJUSTMENT_IN') THEN im.quantity
                   ELSE -im.quantity END), 0) AS on_hand,
                 COALESCE((
                   SELECT SUM(sr.quantity)
                   FROM stock_reservations sr
                   WHERE sr.tenant_id = ${actor.tenantId}::uuid
                     AND sr.material_id = mm.id
                     AND sr.warehouse_id = wh.id
                     AND sr.status = 'OPEN'
                 ), 0) AS reserved
          FROM warehouses wh
          CROSS JOIN material_masters mm
          JOIN nexus_objects no ON no.id = mm.material_object_id
          LEFT JOIN inventory_movements im
            ON im.warehouse_id = wh.id
           AND im.material_id = mm.id
           AND im.tenant_id = ${actor.tenantId}::uuid
          WHERE wh.tenant_id = ${actor.tenantId}::uuid
            AND wh.workspace_id = ${query.data.workspaceId}::uuid
            AND mm.tenant_id = ${actor.tenantId}::uuid
            AND mm.workspace_id = ${query.data.workspaceId}::uuid
            AND wh.is_active = true AND mm.is_active = true
          GROUP BY mm.id, mm.code, no.title, wh.id, wh.code, wh.name
          HAVING COALESCE(SUM(CASE
                   WHEN im.movement_type IN ('RECEIPT','TRANSFER_IN','ADJUSTMENT_IN') THEN im.quantity
                   ELSE -im.quantity END), 0) <> 0
              OR COALESCE((
                   SELECT SUM(sr.quantity)
                   FROM stock_reservations sr
                   WHERE sr.tenant_id = ${actor.tenantId}::uuid
                     AND sr.material_id = mm.id
                     AND sr.warehouse_id = wh.id
                     AND sr.status = 'OPEN'
                 ), 0) <> 0
          ORDER BY no.title, wh.code
        `);

        const openOrders = await tx.$queryRaw<Array<{ count: bigint | number }>>(Prisma.sql`
          SELECT COUNT(*) AS count
          FROM purchase_orders
          WHERE tenant_id = ${actor.tenantId}::uuid
            AND workspace_id = ${query.data.workspaceId}::uuid
            AND status IN ('APPROVED','ORDERED','PARTIAL')
        `);

        const atRisk = items.filter((item) => item.taskAtRisk === true);
        const critical = items.filter((item) => item.riskLevel === 'CRITICAL');
        const shortage = items.filter((item) => item.state === 'SHORTAGE');
        const taskRiskIds = [...new Set(
          atRisk.map((item) => typeof item.workItemId === 'string' ? item.workItemId : null).filter(Boolean),
        )];

        return {
          kind: 'ok' as const,
          payload: {
            workspaceId: query.data.workspaceId,
            projectId: query.data.projectId ?? null,
            asOf,
            summary: {
              requirementCount: items.length,
              atRiskCount: atRisk.length,
              criticalCount: critical.length,
              shortageCount: shortage.length,
              taskAtRiskCount: taskRiskIds.length,
              totalDeficitQty: shortage.reduce((sum, item) => sum + Number(item.deficitQty ?? 0), 0),
              openPurchaseOrderCount: Number(openOrders[0]?.count ?? 0),
            },
            taskRiskIds,
            requirements: items,
            stock: stock.map((row) => ({
              materialId: row.material_id,
              materialCode: row.material_code,
              materialTitle: row.material_title,
              warehouseId: row.warehouse_id,
              warehouseCode: row.warehouse_code,
              warehouseName: row.warehouse_name,
              onHandQty: numberOf(row.on_hand),
              reservedQty: numberOf(row.reserved),
              availableQty: Math.max(0, numberOf(row.on_hand) - numberOf(row.reserved)),
            })),
          },
        };
      });

      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });
      return result.payload;
    },
  );
}
