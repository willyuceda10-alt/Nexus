import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canAccessWorkspace } from '../authorization.js';
import { withTenant } from '../tenant-transaction.js';

const querySchema = z.object({
  workspaceId: z.string().uuid(),
  materialId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  sapMovementType: z.enum(['101', '102', '221', '222']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

type MovementRow = {
  id: string;
  material_id: string;
  material_code: string;
  material_title: string;
  uom_code: string;
  warehouse_id: string;
  warehouse_code: string;
  warehouse_name: string;
  canonical_movement_type: string;
  quantity: Prisma.Decimal | number | string;
  occurred_at: Date | string;
  external_key: string;
  sap_movement_type: string | null;
  wbs_element: string | null;
  purchase_order_number: string | null;
  purchase_order_position: string | null;
};

function numberOf(value: Prisma.Decimal | number | string): number {
  return Number(value);
}

function isoOf(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function matdocIdentity(externalKey: string): {
  fiscalYear: string | null;
  materialDocumentNumber: string | null;
  materialDocumentItem: string | null;
} {
  const match = /^MATDOC:(\d{4}):([^:]+):([^:]+)$/.exec(externalKey);
  return match
    ? {
        fiscalYear: match[1] ?? null,
        materialDocumentNumber: match[2] ?? null,
        materialDocumentItem: match[3] ?? null,
      }
    : { fiscalYear: null, materialDocumentNumber: null, materialDocumentItem: null };
}

function signedQuantity(sapMovementType: string | null, quantity: number): number {
  if (sapMovementType === '102' || sapMovementType === '221') return -quantity;
  if (sapMovementType === '101' || sapMovementType === '222') return quantity;
  return quantity;
}

function movementLabel(sapMovementType: string | null): string {
  if (sapMovementType === '101') return 'Ingreso por compra';
  if (sapMovementType === '102') return 'Reversa de ingreso';
  if (sapMovementType === '221') return 'Consumo a proyecto';
  if (sapMovementType === '222') return 'Reversa de consumo';
  return 'Movimiento SAP';
}

export async function sapInventoryViewV1g4Routes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/material-engine-v2/sap-inventory-v1g4',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const parsed = querySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() });
      }

      const actor = request.actor!;
      const query = parsed.data;

      const result = await withTenant(actor.tenantId, async (tx) => {
        if (!(await canAccessWorkspace(tx, actor, query.workspaceId))) {
          return { kind: 'forbidden' as const };
        }

        const materialFilter = query.materialId
          ? Prisma.sql`AND im.material_id = ${query.materialId}::uuid`
          : Prisma.empty;
        const warehouseFilter = query.warehouseId
          ? Prisma.sql`AND im.warehouse_id = ${query.warehouseId}::uuid`
          : Prisma.empty;
        const movementFilter = query.sapMovementType
          ? Prisma.sql`AND link.metadata->>'sapMovementType' = ${query.sapMovementType}`
          : Prisma.empty;

        const rows = await tx.$queryRaw<MovementRow[]>(Prisma.sql`
          SELECT
            im.id,
            im.material_id,
            mm.code AS material_code,
            material_object.title AS material_title,
            uom.code AS uom_code,
            im.warehouse_id,
            wh.code AS warehouse_code,
            wh.name AS warehouse_name,
            im.movement_type AS canonical_movement_type,
            im.quantity,
            im.occurred_at,
            link.external_key,
            link.metadata->>'sapMovementType' AS sap_movement_type,
            record.normalized_payload->>'wbsElement' AS wbs_element,
            record.normalized_payload->>'purchaseOrderNumber' AS purchase_order_number,
            record.normalized_payload->>'purchaseOrderPosition' AS purchase_order_position
          FROM integration_entity_links link
          JOIN inventory_movements im
            ON im.id = link.canonical_entity_id
           AND im.tenant_id = link.tenant_id
          JOIN material_masters mm
            ON mm.id = im.material_id
           AND mm.tenant_id = im.tenant_id
          JOIN nexus_objects material_object
            ON material_object.id = mm.material_object_id
           AND material_object.tenant_id = im.tenant_id
          JOIN unit_of_measures uom
            ON uom.id = mm.base_uom_id
           AND uom.tenant_id = im.tenant_id
          JOIN warehouses wh
            ON wh.id = im.warehouse_id
           AND wh.tenant_id = im.tenant_id
          LEFT JOIN integration_import_records record
            ON record.id = link.source_record_id
           AND record.tenant_id = link.tenant_id
          WHERE link.tenant_id = ${actor.tenantId}::uuid
            AND link.external_entity_type = 'SAP_MATERIAL_DOCUMENT_ITEM'
            AND link.canonical_entity_type = 'INVENTORY_MOVEMENT'
            AND im.workspace_id = ${query.workspaceId}::uuid
            ${materialFilter}
            ${warehouseFilter}
            ${movementFilter}
          ORDER BY im.occurred_at DESC, link.external_key DESC
          LIMIT ${query.limit}
        `);

        const movements = rows.map((row) => {
          const quantity = numberOf(row.quantity);
          const identity = matdocIdentity(row.external_key);
          return {
            id: row.id,
            externalKey: row.external_key,
            ...identity,
            sapMovementType: row.sap_movement_type,
            label: movementLabel(row.sap_movement_type),
            canonicalMovementType: row.canonical_movement_type,
            quantity,
            signedQuantity: signedQuantity(row.sap_movement_type, quantity),
            occurredAt: isoOf(row.occurred_at),
            materialId: row.material_id,
            materialCode: row.material_code,
            materialTitle: row.material_title,
            uomCode: row.uom_code,
            warehouseId: row.warehouse_id,
            warehouseCode: row.warehouse_code,
            warehouseName: row.warehouse_name,
            wbsElement: row.wbs_element,
            purchaseOrderNumber: row.purchase_order_number,
            purchaseOrderPosition: row.purchase_order_position,
          };
        });

        return {
          kind: 'ok' as const,
          payload: {
            version: 'v1g4' as const,
            canonicalDatabase: 'BRIDATA_POSTGRESQL' as const,
            excelRuntimeDependency: false as const,
            workspaceId: query.workspaceId,
            generatedAt: new Date().toISOString(),
            summary: {
              movementCount: movements.length,
              materialCount: new Set(movements.map((item) => item.materialId)).size,
              warehouseCount: new Set(movements.map((item) => item.warehouseId)).size,
              receipt101Count: movements.filter((item) => item.sapMovementType === '101').length,
              reversal102Count: movements.filter((item) => item.sapMovementType === '102').length,
              issue221Count: movements.filter((item) => item.sapMovementType === '221').length,
              reversal222Count: movements.filter((item) => item.sapMovementType === '222').length,
              lastSapActivityAt: movements[0]?.occurredAt ?? null,
            },
            movements,
            rules: {
              stockSource: 'CANONICAL_INVENTORY_MOVEMENTS' as const,
              sapIdentitySource: 'INTEGRATION_ENTITY_LINKS' as const,
              receipt101Direction: 'IN' as const,
              reversal102Direction: 'OUT' as const,
              issue221Direction: 'OUT' as const,
              reversal222Direction: 'IN' as const,
            },
          },
        };
      });

      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });
      return result.payload;
    },
  );
}
