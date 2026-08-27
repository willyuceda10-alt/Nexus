import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canManageWorkspace } from '../authorization.js';
import { withTenant } from '../tenant-transaction.js';

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const requirementSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  workItemId: z.string().uuid().nullable().optional(),
  materialId: z.string().uuid(),
  preferredWarehouseId: z.string().uuid().nullable().optional(),
  requiredQty: z.number().positive(),
  requiredDate: dateOnlySchema,
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  notes: z.string().max(4000).nullable().optional(),
});
const reservationSchema = z.object({
  requirementId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  quantity: z.number().positive(),
});
const requisitionSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
  number: z.string().trim().min(1).max(80),
  requiredDate: dateOnlySchema.nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  lines: z.array(z.object({
    materialId: z.string().uuid(),
    requirementId: z.string().uuid().nullable().optional(),
    uomId: z.string().uuid(),
    quantity: z.number().positive(),
    estimatedUnitCost: z.number().min(0).default(0),
  })).min(1).max(500),
});
const orderSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
  supplierId: z.string().uuid(),
  number: z.string().trim().min(1).max(80),
  orderDate: dateOnlySchema.optional(),
  expectedDate: dateOnlySchema.nullable().optional(),
  currency: z.string().trim().length(3).default('USD'),
  notes: z.string().max(4000).nullable().optional(),
  lines: z.array(z.object({
    materialId: z.string().uuid(),
    requirementId: z.string().uuid().nullable().optional(),
    uomId: z.string().uuid(),
    quantity: z.number().positive(),
    unitCost: z.number().min(0).default(0),
    expectedDate: dateOnlySchema.nullable().optional(),
  })).min(1).max(500),
});
const receiptSchema = z.object({
  workspaceId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  purchaseOrderId: z.string().uuid().nullable().optional(),
  number: z.string().trim().min(1).max(80),
  receivedAt: z.string().datetime().optional(),
  notes: z.string().max(4000).nullable().optional(),
  lines: z.array(z.object({
    purchaseOrderLineId: z.string().uuid().nullable().optional(),
    materialId: z.string().uuid(),
    requirementId: z.string().uuid().nullable().optional(),
    uomId: z.string().uuid(),
    quantity: z.number().positive(),
    unitCost: z.number().min(0).default(0),
  })).min(1).max(500),
});
const issueSchema = z.object({
  workspaceId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  materialId: z.string().uuid(),
  requirementId: z.string().uuid().nullable().optional(),
  workItemId: z.string().uuid().nullable().optional(),
  quantity: z.number().positive(),
  unitCost: z.number().min(0).default(0),
  occurredAt: z.string().datetime().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

type RequirementRow = {
  id: string;
  workspace_id: string;
  project_object_id: string;
  work_item_object_id: string | null;
  material_id: string;
  required_qty: Prisma.Decimal | number | string;
  required_date: Date | string;
  status: string;
};
type QuantityRow = { quantity: Prisma.Decimal | number | string | null };
type ReservationRow = { id: string; quantity: Prisma.Decimal | number | string };
type PoLineRow = {
  id: string;
  purchase_order_id: string;
  material_id: string;
  requirement_id: string | null;
  uom_id: string;
  quantity: Prisma.Decimal | number | string;
  received_qty: Prisma.Decimal | number | string;
  unit_cost: Prisma.Decimal | number | string;
};

function numberOf(value: Prisma.Decimal | number | string | null): number {
  return value == null ? 0 : Number(value);
}

function projectIdFromMetadata(value: Prisma.JsonValue | null): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const projectId = (value as Record<string, Prisma.JsonValue>).projectId;
  return typeof projectId === 'string' ? projectId : null;
}

async function validateProjectAndWorkItem(
  tx: Prisma.TransactionClient,
  tenantId: string,
  workspaceId: string,
  projectId: string,
  workItemId?: string | null,
): Promise<'ok' | 'project_not_found' | 'work_item_not_found'> {
  const project = await tx.nexusObject.findFirst({
    where: { id: projectId, tenantId, workspaceId, objectTypeKey: 'PROJECT', deletedAt: null },
    select: { id: true },
  });
  if (!project) return 'project_not_found';
  if (!workItemId) return 'ok';
  const workItem = await tx.nexusObject.findFirst({
    where: {
      id: workItemId,
      tenantId,
      workspaceId,
      objectTypeKey: { in: ['TASK', 'DELIVERABLE', 'MILESTONE'] },
      deletedAt: null,
    },
    select: { metadata: true },
  });
  if (!workItem || projectIdFromMetadata(workItem.metadata) !== projectId) return 'work_item_not_found';
  return 'ok';
}

async function materialExistsInWorkspace(
  tx: Prisma.TransactionClient,
  tenantId: string,
  workspaceId: string,
  materialId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM material_masters
    WHERE id = ${materialId}::uuid
      AND tenant_id = ${tenantId}::uuid
      AND workspace_id = ${workspaceId}::uuid
      AND is_active = true
  `);
  return rows.length > 0;
}

async function warehouseExists(
  tx: Prisma.TransactionClient,
  tenantId: string,
  workspaceId: string,
  warehouseId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM warehouses
    WHERE id = ${warehouseId}::uuid
      AND tenant_id = ${tenantId}::uuid
      AND workspace_id = ${workspaceId}::uuid
      AND is_active = true
  `);
  return rows.length > 0;
}

async function onHandQty(
  tx: Prisma.TransactionClient,
  tenantId: string,
  workspaceId: string,
  warehouseId: string,
  materialId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<QuantityRow[]>(Prisma.sql`
    SELECT COALESCE(SUM(
      CASE WHEN movement_type IN ('RECEIPT','TRANSFER_IN','ADJUSTMENT_IN')
           THEN quantity ELSE -quantity END
    ), 0) AS quantity
    FROM inventory_movements
    WHERE tenant_id = ${tenantId}::uuid
      AND workspace_id = ${workspaceId}::uuid
      AND warehouse_id = ${warehouseId}::uuid
      AND material_id = ${materialId}::uuid
  `);
  return numberOf(rows[0]?.quantity ?? 0);
}

async function reservedQty(
  tx: Prisma.TransactionClient,
  tenantId: string,
  warehouseId: string,
  materialId: string,
  excludingRequirementId?: string | null,
): Promise<number> {
  const rows = excludingRequirementId
    ? await tx.$queryRaw<QuantityRow[]>(Prisma.sql`
        SELECT COALESCE(SUM(quantity), 0) AS quantity
        FROM stock_reservations
        WHERE tenant_id = ${tenantId}::uuid
          AND warehouse_id = ${warehouseId}::uuid
          AND material_id = ${materialId}::uuid
          AND status = 'OPEN'
          AND requirement_id <> ${excludingRequirementId}::uuid
      `)
    : await tx.$queryRaw<QuantityRow[]>(Prisma.sql`
        SELECT COALESCE(SUM(quantity), 0) AS quantity
        FROM stock_reservations
        WHERE tenant_id = ${tenantId}::uuid
          AND warehouse_id = ${warehouseId}::uuid
          AND material_id = ${materialId}::uuid
          AND status = 'OPEN'
      `);
  return numberOf(rows[0]?.quantity ?? 0);
}

async function issuedForRequirement(
  tx: Prisma.TransactionClient,
  tenantId: string,
  requirementId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<QuantityRow[]>(Prisma.sql`
    SELECT COALESCE(SUM(quantity), 0) AS quantity
    FROM inventory_movements
    WHERE tenant_id = ${tenantId}::uuid
      AND requirement_id = ${requirementId}::uuid
      AND movement_type = 'ISSUE'
  `);
  return numberOf(rows[0]?.quantity ?? 0);
}

async function refreshRequirementStatus(
  tx: Prisma.TransactionClient,
  tenantId: string,
  requirementId: string,
): Promise<void> {
  const requirements = await tx.$queryRaw<RequirementRow[]>(Prisma.sql`
    SELECT id, workspace_id, project_object_id, work_item_object_id, material_id,
           required_qty, required_date, status
    FROM material_requirements
    WHERE id = ${requirementId}::uuid AND tenant_id = ${tenantId}::uuid
  `);
  const requirement = requirements[0];
  if (!requirement || requirement.status === 'CANCELLED') return;
  const [issued, reservations] = await Promise.all([
    issuedForRequirement(tx, tenantId, requirementId),
    tx.$queryRaw<QuantityRow[]>(Prisma.sql`
      SELECT COALESCE(SUM(quantity), 0) AS quantity
      FROM stock_reservations
      WHERE tenant_id = ${tenantId}::uuid
        AND requirement_id = ${requirementId}::uuid
        AND status = 'OPEN'
    `),
  ]);
  const required = numberOf(requirement.required_qty);
  const remaining = Math.max(0, required - issued);
  const reserved = numberOf(reservations[0]?.quantity ?? 0);
  const status = issued >= required
    ? 'FULFILLED'
    : reserved >= remaining && remaining > 0
      ? 'ALLOCATED'
      : reserved > 0
        ? 'PARTIALLY_ALLOCATED'
        : 'OPEN';
  await tx.$executeRaw(Prisma.sql`
    UPDATE material_requirements
    SET status = ${status}, updated_at = CURRENT_TIMESTAMP
    WHERE id = ${requirementId}::uuid AND tenant_id = ${tenantId}::uuid
  `);
}

export async function materialOperationsV2Routes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/v1/material-engine-v2/requirements',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const body = requirementSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'validation_error', details: body.error.flatten() });
      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        if (!(await canManageWorkspace(tx, actor, body.data.workspaceId))) return { kind: 'forbidden' as const };
        const link = await validateProjectAndWorkItem(
          tx, actor.tenantId, body.data.workspaceId, body.data.projectId, body.data.workItemId,
        );
        if (link !== 'ok') return { kind: link } as const;
        if (!(await materialExistsInWorkspace(tx, actor.tenantId, body.data.workspaceId, body.data.materialId))) {
          return { kind: 'material_not_found' as const };
        }
        if (body.data.preferredWarehouseId && !(await warehouseExists(
          tx, actor.tenantId, body.data.workspaceId, body.data.preferredWarehouseId,
        ))) return { kind: 'warehouse_not_found' as const };

        const rows = await tx.$queryRaw<RequirementRow[]>(Prisma.sql`
          INSERT INTO material_requirements
            (tenant_id, workspace_id, project_object_id, work_item_object_id,
             material_id, preferred_warehouse_id, required_qty, required_date,
             priority, notes, updated_at)
          VALUES
            (${actor.tenantId}::uuid, ${body.data.workspaceId}::uuid, ${body.data.projectId}::uuid,
             ${body.data.workItemId ?? null}::uuid, ${body.data.materialId}::uuid,
             ${body.data.preferredWarehouseId ?? null}::uuid, ${body.data.requiredQty},
             ${body.data.requiredDate}::date, ${body.data.priority}, ${body.data.notes ?? null},
             CURRENT_TIMESTAMP)
          RETURNING id, workspace_id, project_object_id, work_item_object_id,
                    material_id, required_qty, required_date, status
        `);
        const created = rows[0]!;
        await tx.domainEvent.create({
          data: {
            tenantId: actor.tenantId,
            aggregateId: created.id,
            eventType: 'bridata.material.requirement.created',
            payload: {
              requirementId: created.id,
              projectId: created.project_object_id,
              workItemId: created.work_item_object_id,
              materialId: created.material_id,
              requiredQty: body.data.requiredQty,
              requiredDate: body.data.requiredDate,
              actorId: actor.userId,
            },
          },
        });
        return { kind: 'ok' as const, payload: { id: created.id, status: created.status } };
      });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'material_requirement_denied' });
      if (result.kind === 'project_not_found') return reply.code(404).send({ error: 'project_not_found' });
      if (result.kind === 'work_item_not_found') return reply.code(404).send({ error: 'work_item_not_found' });
      if (result.kind === 'material_not_found') return reply.code(404).send({ error: 'material_master_not_found' });
      if (result.kind === 'warehouse_not_found') return reply.code(404).send({ error: 'warehouse_not_found' });
      return reply.code(201).send(result.payload);
    },
  );

  app.post(
    '/api/v1/material-engine-v2/reservations',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const body = reservationSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'validation_error', details: body.error.flatten() });
      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const requirements = await tx.$queryRaw<RequirementRow[]>(Prisma.sql`
          SELECT id, workspace_id, project_object_id, work_item_object_id, material_id,
                 required_qty, required_date, status
          FROM material_requirements
          WHERE id = ${body.data.requirementId}::uuid
            AND tenant_id = ${actor.tenantId}::uuid
        `);
        const requirement = requirements[0];
        if (!requirement) return { kind: 'not_found' as const };
        if (!(await canManageWorkspace(tx, actor, requirement.workspace_id))) return { kind: 'forbidden' as const };
        if (!(await warehouseExists(tx, actor.tenantId, requirement.workspace_id, body.data.warehouseId))) {
          return { kind: 'warehouse_not_found' as const };
        }
        if (requirement.status === 'CANCELLED' || requirement.status === 'FULFILLED') {
          return { kind: 'closed' as const };
        }

        const [onHand, allReserved, requirementReserved, issued] = await Promise.all([
          onHandQty(tx, actor.tenantId, requirement.workspace_id, body.data.warehouseId, requirement.material_id),
          reservedQty(tx, actor.tenantId, body.data.warehouseId, requirement.material_id),
          tx.$queryRaw<QuantityRow[]>(Prisma.sql`
            SELECT COALESCE(SUM(quantity), 0) AS quantity FROM stock_reservations
            WHERE tenant_id = ${actor.tenantId}::uuid
              AND requirement_id = ${requirement.id}::uuid
              AND status = 'OPEN'
          `),
          issuedForRequirement(tx, actor.tenantId, requirement.id),
        ]);
        const available = Math.max(0, onHand - allReserved);
        const remainingDemand = Math.max(
          0,
          numberOf(requirement.required_qty) - issued - numberOf(requirementReserved[0]?.quantity ?? 0),
        );
        if (body.data.quantity > available + 0.000001) {
          return { kind: 'insufficient_stock' as const, available };
        }
        if (body.data.quantity > remainingDemand + 0.000001) {
          return { kind: 'over_requirement' as const, remainingDemand };
        }

        const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          INSERT INTO stock_reservations
            (tenant_id, requirement_id, material_id, warehouse_id, quantity, updated_at)
          VALUES
            (${actor.tenantId}::uuid, ${requirement.id}::uuid, ${requirement.material_id}::uuid,
             ${body.data.warehouseId}::uuid, ${body.data.quantity}, CURRENT_TIMESTAMP)
          RETURNING id
        `);
        await refreshRequirementStatus(tx, actor.tenantId, requirement.id);
        await tx.domainEvent.create({
          data: {
            tenantId: actor.tenantId,
            aggregateId: requirement.id,
            eventType: 'bridata.material.stock.reserved',
            payload: {
              requirementId: requirement.id,
              reservationId: rows[0]!.id,
              warehouseId: body.data.warehouseId,
              quantity: body.data.quantity,
              actorId: actor.userId,
            },
          },
        });
        return { kind: 'ok' as const, payload: { id: rows[0]!.id, availableAfter: available - body.data.quantity } };
      });
      if (result.kind === 'not_found') return reply.code(404).send({ error: 'requirement_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'reservation_denied' });
      if (result.kind === 'warehouse_not_found') return reply.code(404).send({ error: 'warehouse_not_found' });
      if (result.kind === 'closed') return reply.code(409).send({ error: 'requirement_closed' });
      if (result.kind === 'insufficient_stock') return reply.code(409).send({ error: 'insufficient_available_stock', availableQty: result.available });
      if (result.kind === 'over_requirement') return reply.code(409).send({ error: 'reservation_exceeds_requirement', remainingDemand: result.remainingDemand });
      return reply.code(201).send(result.payload);
    },
  );

  app.post(
    '/api/v1/material-engine-v2/purchase-requisitions',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const body = requisitionSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'validation_error', details: body.error.flatten() });
      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        if (!(await canManageWorkspace(tx, actor, body.data.workspaceId))) return { kind: 'forbidden' as const };
        if (body.data.projectId) {
          const valid = await validateProjectAndWorkItem(tx, actor.tenantId, body.data.workspaceId, body.data.projectId);
          if (valid !== 'ok') return { kind: 'project_not_found' as const };
        }
        for (const line of body.data.lines) {
          if (!(await materialExistsInWorkspace(tx, actor.tenantId, body.data.workspaceId, line.materialId))) {
            return { kind: 'material_not_found' as const };
          }
        }
        const headers = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          INSERT INTO purchase_requisitions
            (tenant_id, workspace_id, project_object_id, number, status,
             required_date, requested_by_user_id, notes, updated_at)
          VALUES
            (${actor.tenantId}::uuid, ${body.data.workspaceId}::uuid,
             ${body.data.projectId ?? null}::uuid, ${body.data.number}, 'SUBMITTED',
             ${body.data.requiredDate ?? null}::date, ${actor.userId}::uuid,
             ${body.data.notes ?? null}, CURRENT_TIMESTAMP)
          RETURNING id
        `);
        const id = headers[0]!.id;
        for (const line of body.data.lines) {
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO purchase_requisition_lines
              (tenant_id, requisition_id, material_id, requirement_id, uom_id,
               quantity, estimated_unit_cost)
            VALUES
              (${actor.tenantId}::uuid, ${id}::uuid, ${line.materialId}::uuid,
               ${line.requirementId ?? null}::uuid, ${line.uomId}::uuid,
               ${line.quantity}, ${line.estimatedUnitCost})
          `);
        }
        await tx.domainEvent.create({
          data: {
            tenantId: actor.tenantId,
            aggregateId: id,
            eventType: 'bridata.purchase.requisition.submitted',
            payload: { requisitionId: id, number: body.data.number, lineCount: body.data.lines.length, actorId: actor.userId },
          },
        });
        return { kind: 'ok' as const, payload: { id, number: body.data.number, status: 'SUBMITTED', lineCount: body.data.lines.length } };
      });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'purchase_requisition_denied' });
      if (result.kind === 'project_not_found') return reply.code(404).send({ error: 'project_not_found' });
      if (result.kind === 'material_not_found') return reply.code(404).send({ error: 'material_master_not_found' });
      return reply.code(201).send(result.payload);
    },
  );

  app.post(
    '/api/v1/material-engine-v2/purchase-orders',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const body = orderSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'validation_error', details: body.error.flatten() });
      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        if (!(await canManageWorkspace(tx, actor, body.data.workspaceId))) return { kind: 'forbidden' as const };
        const supplier = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id FROM suppliers
          WHERE id = ${body.data.supplierId}::uuid
            AND tenant_id = ${actor.tenantId}::uuid AND is_active = true
        `);
        if (!supplier[0]) return { kind: 'supplier_not_found' as const };
        for (const line of body.data.lines) {
          if (!(await materialExistsInWorkspace(tx, actor.tenantId, body.data.workspaceId, line.materialId))) {
            return { kind: 'material_not_found' as const };
          }
        }
        const headers = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          INSERT INTO purchase_orders
            (tenant_id, workspace_id, project_object_id, supplier_id, number, status,
             order_date, expected_date, currency, notes, updated_at)
          VALUES
            (${actor.tenantId}::uuid, ${body.data.workspaceId}::uuid,
             ${body.data.projectId ?? null}::uuid, ${body.data.supplierId}::uuid,
             ${body.data.number}, 'ORDERED', ${body.data.orderDate ?? new Date().toISOString().slice(0, 10)}::date,
             ${body.data.expectedDate ?? null}::date, ${body.data.currency.toUpperCase()},
             ${body.data.notes ?? null}, CURRENT_TIMESTAMP)
          RETURNING id
        `);
        const id = headers[0]!.id;
        for (const line of body.data.lines) {
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO purchase_order_lines
              (tenant_id, purchase_order_id, material_id, requirement_id, uom_id,
               quantity, unit_cost, expected_date, updated_at)
            VALUES
              (${actor.tenantId}::uuid, ${id}::uuid, ${line.materialId}::uuid,
               ${line.requirementId ?? null}::uuid, ${line.uomId}::uuid,
               ${line.quantity}, ${line.unitCost}, ${line.expectedDate ?? body.data.expectedDate ?? null}::date,
               CURRENT_TIMESTAMP)
          `);
        }
        await tx.domainEvent.create({
          data: {
            tenantId: actor.tenantId,
            aggregateId: id,
            eventType: 'bridata.purchase.order.ordered',
            payload: { purchaseOrderId: id, number: body.data.number, lineCount: body.data.lines.length, actorId: actor.userId },
          },
        });
        return { kind: 'ok' as const, payload: { id, number: body.data.number, status: 'ORDERED', lineCount: body.data.lines.length } };
      });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'purchase_order_denied' });
      if (result.kind === 'supplier_not_found') return reply.code(404).send({ error: 'supplier_not_found' });
      if (result.kind === 'material_not_found') return reply.code(404).send({ error: 'material_master_not_found' });
      return reply.code(201).send(result.payload);
    },
  );

  app.post(
    '/api/v1/material-engine-v2/goods-receipts',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const body = receiptSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'validation_error', details: body.error.flatten() });
      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        if (!(await canManageWorkspace(tx, actor, body.data.workspaceId))) return { kind: 'forbidden' as const };
        if (!(await warehouseExists(tx, actor.tenantId, body.data.workspaceId, body.data.warehouseId))) {
          return { kind: 'warehouse_not_found' as const };
        }
        const poLines = new Map<string, PoLineRow>();
        for (const line of body.data.lines) {
          if (!(await materialExistsInWorkspace(tx, actor.tenantId, body.data.workspaceId, line.materialId))) {
            return { kind: 'material_not_found' as const };
          }
          if (line.purchaseOrderLineId) {
            const rows = await tx.$queryRaw<PoLineRow[]>(Prisma.sql`
              SELECT pol.id, pol.purchase_order_id, pol.material_id, pol.requirement_id,
                     pol.uom_id, pol.quantity, pol.received_qty, pol.unit_cost
              FROM purchase_order_lines pol
              JOIN purchase_orders po ON po.id = pol.purchase_order_id
              WHERE pol.id = ${line.purchaseOrderLineId}::uuid
                AND pol.tenant_id = ${actor.tenantId}::uuid
                AND po.workspace_id = ${body.data.workspaceId}::uuid
                AND po.status <> 'CANCELLED'
            `);
            const poLine = rows[0];
            if (!poLine) return { kind: 'po_line_not_found' as const };
            if (poLine.material_id !== line.materialId) return { kind: 'po_line_material_mismatch' as const };
            const outstanding = numberOf(poLine.quantity) - numberOf(poLine.received_qty);
            if (line.quantity > outstanding + 0.000001) {
              return { kind: 'over_receipt' as const, outstanding };
            }
            poLines.set(line.purchaseOrderLineId, poLine);
          }
        }

        const receipts = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          INSERT INTO goods_receipts
            (tenant_id, workspace_id, warehouse_id, purchase_order_id, number,
             received_at, received_by_user_id, notes)
          VALUES
            (${actor.tenantId}::uuid, ${body.data.workspaceId}::uuid,
             ${body.data.warehouseId}::uuid, ${body.data.purchaseOrderId ?? null}::uuid,
             ${body.data.number}, ${body.data.receivedAt ? new Date(body.data.receivedAt) : new Date()},
             ${actor.userId}::uuid, ${body.data.notes ?? null})
          RETURNING id
        `);
        const receiptId = receipts[0]!.id;
        const touchedRequirements = new Set<string>();
        const touchedOrders = new Set<string>();

        for (const line of body.data.lines) {
          const poLine = line.purchaseOrderLineId ? poLines.get(line.purchaseOrderLineId) : undefined;
          const requirementId = line.requirementId ?? poLine?.requirement_id ?? null;
          const unitCost = line.unitCost || numberOf(poLine?.unit_cost ?? 0);
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO goods_receipt_lines
              (tenant_id, goods_receipt_id, purchase_order_line_id, material_id,
               requirement_id, uom_id, quantity, unit_cost)
            VALUES
              (${actor.tenantId}::uuid, ${receiptId}::uuid,
               ${line.purchaseOrderLineId ?? null}::uuid, ${line.materialId}::uuid,
               ${requirementId}::uuid, ${line.uomId}::uuid, ${line.quantity}, ${unitCost})
          `);
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO inventory_movements
              (tenant_id, workspace_id, warehouse_id, material_id, requirement_id,
               movement_type, quantity, unit_cost, occurred_at, reference_type,
               reference_id, created_by_user_id, notes)
            VALUES
              (${actor.tenantId}::uuid, ${body.data.workspaceId}::uuid,
               ${body.data.warehouseId}::uuid, ${line.materialId}::uuid,
               ${requirementId}::uuid, 'RECEIPT', ${line.quantity}, ${unitCost},
               ${body.data.receivedAt ? new Date(body.data.receivedAt) : new Date()},
               'GOODS_RECEIPT', ${receiptId}::uuid, ${actor.userId}::uuid,
               ${body.data.notes ?? null})
          `);
          if (line.purchaseOrderLineId && poLine) {
            await tx.$executeRaw(Prisma.sql`
              UPDATE purchase_order_lines
              SET received_qty = received_qty + ${line.quantity}, updated_at = CURRENT_TIMESTAMP
              WHERE id = ${line.purchaseOrderLineId}::uuid
                AND tenant_id = ${actor.tenantId}::uuid
            `);
            touchedOrders.add(poLine.purchase_order_id);
          }
          if (requirementId) touchedRequirements.add(requirementId);
        }

        for (const orderId of touchedOrders) {
          const outstanding = await tx.$queryRaw<QuantityRow[]>(Prisma.sql`
            SELECT COALESCE(SUM(quantity - received_qty), 0) AS quantity
            FROM purchase_order_lines
            WHERE tenant_id = ${actor.tenantId}::uuid
              AND purchase_order_id = ${orderId}::uuid
          `);
          const anyReceived = await tx.$queryRaw<QuantityRow[]>(Prisma.sql`
            SELECT COALESCE(SUM(received_qty), 0) AS quantity
            FROM purchase_order_lines
            WHERE tenant_id = ${actor.tenantId}::uuid
              AND purchase_order_id = ${orderId}::uuid
          `);
          const status = numberOf(outstanding[0]?.quantity ?? 0) <= 0.000001
            ? 'RECEIVED'
            : numberOf(anyReceived[0]?.quantity ?? 0) > 0
              ? 'PARTIAL'
              : 'ORDERED';
          await tx.$executeRaw(Prisma.sql`
            UPDATE purchase_orders SET status = ${status}, updated_at = CURRENT_TIMESTAMP
            WHERE id = ${orderId}::uuid AND tenant_id = ${actor.tenantId}::uuid
          `);
        }
        for (const requirementId of touchedRequirements) {
          await refreshRequirementStatus(tx, actor.tenantId, requirementId);
        }
        await tx.domainEvent.create({
          data: {
            tenantId: actor.tenantId,
            aggregateId: receiptId,
            eventType: 'bridata.inventory.goods.received',
            payload: { receiptId, warehouseId: body.data.warehouseId, lineCount: body.data.lines.length, actorId: actor.userId },
          },
        });
        return { kind: 'ok' as const, payload: { id: receiptId, number: body.data.number, status: 'POSTED', lineCount: body.data.lines.length } };
      });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'goods_receipt_denied' });
      if (result.kind === 'warehouse_not_found') return reply.code(404).send({ error: 'warehouse_not_found' });
      if (result.kind === 'material_not_found') return reply.code(404).send({ error: 'material_master_not_found' });
      if (result.kind === 'po_line_not_found') return reply.code(404).send({ error: 'purchase_order_line_not_found' });
      if (result.kind === 'po_line_material_mismatch') return reply.code(409).send({ error: 'purchase_order_line_material_mismatch' });
      if (result.kind === 'over_receipt') return reply.code(409).send({ error: 'receipt_exceeds_outstanding_order', outstandingQty: result.outstanding });
      return reply.code(201).send(result.payload);
    },
  );

  app.post(
    '/api/v1/material-engine-v2/issues',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const body = issueSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'validation_error', details: body.error.flatten() });
      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        if (!(await canManageWorkspace(tx, actor, body.data.workspaceId))) return { kind: 'forbidden' as const };
        if (!(await warehouseExists(tx, actor.tenantId, body.data.workspaceId, body.data.warehouseId))) {
          return { kind: 'warehouse_not_found' as const };
        }
        if (!(await materialExistsInWorkspace(tx, actor.tenantId, body.data.workspaceId, body.data.materialId))) {
          return { kind: 'material_not_found' as const };
        }
        let requirement: RequirementRow | undefined;
        if (body.data.requirementId) {
          const rows = await tx.$queryRaw<RequirementRow[]>(Prisma.sql`
            SELECT id, workspace_id, project_object_id, work_item_object_id, material_id,
                   required_qty, required_date, status
            FROM material_requirements
            WHERE id = ${body.data.requirementId}::uuid
              AND tenant_id = ${actor.tenantId}::uuid
          `);
          requirement = rows[0];
          if (!requirement || requirement.workspace_id !== body.data.workspaceId || requirement.material_id !== body.data.materialId) {
            return { kind: 'requirement_not_found' as const };
          }
        }

        const [onHand, otherReserved] = await Promise.all([
          onHandQty(tx, actor.tenantId, body.data.workspaceId, body.data.warehouseId, body.data.materialId),
          reservedQty(tx, actor.tenantId, body.data.warehouseId, body.data.materialId, body.data.requirementId),
        ]);
        const issuable = Math.max(0, onHand - otherReserved);
        if (body.data.quantity > issuable + 0.000001) {
          return { kind: 'insufficient_stock' as const, issuable };
        }
        if (requirement) {
          const issued = await issuedForRequirement(tx, actor.tenantId, requirement.id);
          const remaining = Math.max(0, numberOf(requirement.required_qty) - issued);
          if (body.data.quantity > remaining + 0.000001) {
            return { kind: 'over_requirement' as const, remaining };
          }
        }

        const movements = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          INSERT INTO inventory_movements
            (tenant_id, workspace_id, warehouse_id, material_id, requirement_id,
             work_item_object_id, movement_type, quantity, unit_cost, occurred_at,
             reference_type, created_by_user_id, notes)
          VALUES
            (${actor.tenantId}::uuid, ${body.data.workspaceId}::uuid,
             ${body.data.warehouseId}::uuid, ${body.data.materialId}::uuid,
             ${body.data.requirementId ?? null}::uuid,
             ${body.data.workItemId ?? requirement?.work_item_object_id ?? null}::uuid,
             'ISSUE', ${body.data.quantity}, ${body.data.unitCost},
             ${body.data.occurredAt ? new Date(body.data.occurredAt) : new Date()},
             'MATERIAL_ISSUE', ${actor.userId}::uuid, ${body.data.notes ?? null})
          RETURNING id
        `);

        if (requirement) {
          let toConsume = body.data.quantity;
          const reservations = await tx.$queryRaw<ReservationRow[]>(Prisma.sql`
            SELECT id, quantity FROM stock_reservations
            WHERE tenant_id = ${actor.tenantId}::uuid
              AND requirement_id = ${requirement.id}::uuid
              AND warehouse_id = ${body.data.warehouseId}::uuid
              AND material_id = ${body.data.materialId}::uuid
              AND status = 'OPEN'
            ORDER BY created_at, id
          `);
          for (const reservation of reservations) {
            if (toConsume <= 0) break;
            const current = numberOf(reservation.quantity);
            const consumed = Math.min(current, toConsume);
            const remaining = current - consumed;
            if (remaining <= 0.000001) {
              await tx.$executeRaw(Prisma.sql`
                UPDATE stock_reservations
                SET status = 'CONSUMED', updated_at = CURRENT_TIMESTAMP
                WHERE id = ${reservation.id}::uuid AND tenant_id = ${actor.tenantId}::uuid
              `);
            } else {
              await tx.$executeRaw(Prisma.sql`
                UPDATE stock_reservations
                SET quantity = ${remaining}, updated_at = CURRENT_TIMESTAMP
                WHERE id = ${reservation.id}::uuid AND tenant_id = ${actor.tenantId}::uuid
              `);
            }
            toConsume -= consumed;
          }
          await refreshRequirementStatus(tx, actor.tenantId, requirement.id);
        }

        await tx.domainEvent.create({
          data: {
            tenantId: actor.tenantId,
            aggregateId: movements[0]!.id,
            eventType: 'bridata.inventory.material.issued',
            payload: {
              movementId: movements[0]!.id,
              materialId: body.data.materialId,
              requirementId: body.data.requirementId,
              workItemId: body.data.workItemId ?? requirement?.work_item_object_id ?? null,
              quantity: body.data.quantity,
              actorId: actor.userId,
            },
          },
        });
        return { kind: 'ok' as const, payload: { id: movements[0]!.id, type: 'ISSUE', quantity: body.data.quantity } };
      });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'material_issue_denied' });
      if (result.kind === 'warehouse_not_found') return reply.code(404).send({ error: 'warehouse_not_found' });
      if (result.kind === 'material_not_found') return reply.code(404).send({ error: 'material_master_not_found' });
      if (result.kind === 'requirement_not_found') return reply.code(404).send({ error: 'requirement_not_found' });
      if (result.kind === 'insufficient_stock') return reply.code(409).send({ error: 'insufficient_stock_for_issue', issuableQty: result.issuable });
      if (result.kind === 'over_requirement') return reply.code(409).send({ error: 'issue_exceeds_requirement', remainingQty: result.remaining });
      return reply.code(201).send(result.payload);
    },
  );
}
