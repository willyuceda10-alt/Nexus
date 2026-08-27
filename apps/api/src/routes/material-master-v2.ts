import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canAccessWorkspace, canManageWorkspace, isTenantAdministrator } from '../authorization.js';
import { withTenant } from '../tenant-transaction.js';

const workspaceQuerySchema = z.object({ workspaceId: z.string().uuid() });
const materialSyncSchema = z.object({
  materialObjectId: z.string().uuid(),
  code: z.string().trim().min(1).max(100),
  uomCode: z.string().trim().min(1).max(30).default('UND'),
  uomName: z.string().trim().min(1).max(100).default('Unidad'),
  decimalPlaces: z.number().int().min(0).max(6).default(2),
  unitCost: z.number().min(0).default(0),
  currency: z.string().trim().length(3).default('USD'),
});
const warehouseSchema = z.object({
  workspaceId: z.string().uuid(),
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(255),
});
const supplierSchema = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(255),
  taxId: z.string().trim().max(50).nullable().optional(),
  email: z.string().email().max(255).nullable().optional(),
  phone: z.string().trim().max(80).nullable().optional(),
});
const backfillSchema = z.object({
  workspaceId: z.string().uuid(),
  dryRun: z.boolean().default(true),
});

type UomRow = {
  id: string;
  code: string;
  name: string;
  decimal_places: number;
};
type MaterialRow = {
  id: string;
  material_object_id: string;
  code: string;
  base_uom_id: string;
  uom_code: string;
  uom_name: string;
  unit_cost: Prisma.Decimal | number | string;
  currency: string;
  is_active: boolean;
  title: string;
};
type WarehouseRow = { id: string; code: string; name: string; is_active: boolean };
type SupplierRow = {
  id: string;
  code: string;
  name: string;
  tax_id: string | null;
  email: string | null;
  phone: string | null;
  is_active: boolean;
};

function numberOf(value: Prisma.Decimal | number | string): number {
  return Number(value);
}

async function upsertUom(
  tx: Prisma.TransactionClient,
  tenantId: string,
  code: string,
  name: string,
  decimalPlaces: number,
): Promise<UomRow> {
  const rows = await tx.$queryRaw<UomRow[]>(Prisma.sql`
    INSERT INTO unit_of_measures (tenant_id, code, name, decimal_places, updated_at)
    VALUES (${tenantId}::uuid, ${code.toUpperCase()}, ${name}, ${decimalPlaces}, CURRENT_TIMESTAMP)
    ON CONFLICT (tenant_id, code)
    DO UPDATE SET name = EXCLUDED.name, decimal_places = EXCLUDED.decimal_places,
                  is_active = true, updated_at = CURRENT_TIMESTAMP
    RETURNING id, code, name, decimal_places
  `);
  return rows[0]!;
}

export async function materialMasterV2Routes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/material-engine-v2/setup',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const query = workspaceQuerySchema.safeParse(request.query);
      if (!query.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;

      const result = await withTenant(actor.tenantId, async (tx) => {
        if (!(await canAccessWorkspace(tx, actor, query.data.workspaceId))) {
          return { kind: 'forbidden' as const };
        }
        const [uoms, materials, warehouses, suppliers] = await Promise.all([
          tx.$queryRaw<UomRow[]>(Prisma.sql`
            SELECT id, code, name, decimal_places
            FROM unit_of_measures
            WHERE tenant_id = ${actor.tenantId}::uuid AND is_active = true
            ORDER BY code
          `),
          tx.$queryRaw<MaterialRow[]>(Prisma.sql`
            SELECT mm.id, mm.material_object_id, mm.code, mm.base_uom_id,
                   u.code AS uom_code, u.name AS uom_name, mm.unit_cost,
                   mm.currency, mm.is_active, no.title
            FROM material_masters mm
            JOIN unit_of_measures u ON u.id = mm.base_uom_id
            JOIN nexus_objects no ON no.id = mm.material_object_id
            WHERE mm.tenant_id = ${actor.tenantId}::uuid
              AND mm.workspace_id = ${query.data.workspaceId}::uuid
              AND no.deleted_at IS NULL
            ORDER BY no.title
          `),
          tx.$queryRaw<WarehouseRow[]>(Prisma.sql`
            SELECT id, code, name, is_active
            FROM warehouses
            WHERE tenant_id = ${actor.tenantId}::uuid
              AND workspace_id = ${query.data.workspaceId}::uuid
            ORDER BY code
          `),
          tx.$queryRaw<SupplierRow[]>(Prisma.sql`
            SELECT id, code, name, tax_id, email, phone, is_active
            FROM suppliers
            WHERE tenant_id = ${actor.tenantId}::uuid
            ORDER BY name
          `),
        ]);
        return {
          kind: 'ok' as const,
          payload: {
            workspaceId: query.data.workspaceId,
            uoms,
            materials: materials.map((row) => ({
              id: row.id,
              materialObjectId: row.material_object_id,
              code: row.code,
              title: row.title,
              baseUomId: row.base_uom_id,
              uomCode: row.uom_code,
              uomName: row.uom_name,
              unitCost: numberOf(row.unit_cost),
              currency: row.currency,
              isActive: row.is_active,
            })),
            warehouses: warehouses.map((row) => ({
              id: row.id,
              code: row.code,
              name: row.name,
              isActive: row.is_active,
            })),
            suppliers: suppliers.map((row) => ({
              id: row.id,
              code: row.code,
              name: row.name,
              taxId: row.tax_id,
              email: row.email,
              phone: row.phone,
              isActive: row.is_active,
            })),
          },
        };
      });

      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });
      return result.payload;
    },
  );

  app.post(
    '/api/v1/material-engine-v2/materials/sync',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const body = materialSyncSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'validation_error', details: body.error.flatten() });
      const actor = request.actor!;

      const result = await withTenant(actor.tenantId, async (tx) => {
        const object = await tx.nexusObject.findFirst({
          where: {
            id: body.data.materialObjectId,
            tenantId: actor.tenantId,
            objectTypeKey: 'MATERIAL',
            deletedAt: null,
          },
          select: { id: true, workspaceId: true, title: true },
        });
        if (!object) return { kind: 'not_found' as const };
        if (!(await canManageWorkspace(tx, actor, object.workspaceId))) {
          return { kind: 'forbidden' as const };
        }

        const uom = await upsertUom(
          tx,
          actor.tenantId,
          body.data.uomCode,
          body.data.uomName,
          body.data.decimalPlaces,
        );
        const rows = await tx.$queryRaw<MaterialRow[]>(Prisma.sql`
          INSERT INTO material_masters
            (tenant_id, workspace_id, material_object_id, code, base_uom_id,
             unit_cost, currency, is_active, updated_at)
          VALUES
            (${actor.tenantId}::uuid, ${object.workspaceId}::uuid, ${object.id}::uuid,
             ${body.data.code}, ${uom.id}::uuid, ${body.data.unitCost},
             ${body.data.currency.toUpperCase()}, true, CURRENT_TIMESTAMP)
          ON CONFLICT (material_object_id)
          DO UPDATE SET code = EXCLUDED.code, base_uom_id = EXCLUDED.base_uom_id,
                        unit_cost = EXCLUDED.unit_cost, currency = EXCLUDED.currency,
                        is_active = true, updated_at = CURRENT_TIMESTAMP
          RETURNING id, material_object_id, code, base_uom_id,
                    ${uom.code}::text AS uom_code, ${uom.name}::text AS uom_name,
                    unit_cost, currency, is_active, ${object.title}::text AS title
        `);
        const saved = rows[0]!;
        await Promise.all([
          tx.domainEvent.create({
            data: {
              tenantId: actor.tenantId,
              aggregateId: object.id,
              eventType: 'bridata.material.master.synced',
              payload: { materialMasterId: saved.id, materialObjectId: object.id, actorId: actor.userId },
            },
          }),
          tx.auditLog.create({
            data: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              action: 'MATERIAL_MASTER_SYNCED',
              resource: 'NEXUS_OBJECT',
              resourceId: object.id,
              correlationId: request.id,
              ipAddress: request.ip,
              details: { materialMasterId: saved.id, code: saved.code, uomCode: uom.code },
            },
          }),
        ]);
        return {
          kind: 'ok' as const,
          payload: {
            id: saved.id,
            materialObjectId: saved.material_object_id,
            code: saved.code,
            title: saved.title,
            baseUomId: saved.base_uom_id,
            uomCode: saved.uom_code,
            uomName: saved.uom_name,
            unitCost: numberOf(saved.unit_cost),
            currency: saved.currency,
          },
        };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'material_object_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'material_management_denied' });
      return reply.code(201).send(result.payload);
    },
  );

  app.post(
    '/api/v1/material-engine-v2/warehouses',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const body = warehouseSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'validation_error', details: body.error.flatten() });
      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        if (!(await canManageWorkspace(tx, actor, body.data.workspaceId))) {
          return { kind: 'forbidden' as const };
        }
        const rows = await tx.$queryRaw<WarehouseRow[]>(Prisma.sql`
          INSERT INTO warehouses (tenant_id, workspace_id, code, name, updated_at)
          VALUES (${actor.tenantId}::uuid, ${body.data.workspaceId}::uuid,
                  ${body.data.code.toUpperCase()}, ${body.data.name}, CURRENT_TIMESTAMP)
          ON CONFLICT (tenant_id, workspace_id, code)
          DO UPDATE SET name = EXCLUDED.name, is_active = true, updated_at = CURRENT_TIMESTAMP
          RETURNING id, code, name, is_active
        `);
        return { kind: 'ok' as const, payload: rows[0]! };
      });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'warehouse_management_denied' });
      return reply.code(201).send({
        id: result.payload.id,
        code: result.payload.code,
        name: result.payload.name,
        isActive: result.payload.is_active,
      });
    },
  );

  app.post(
    '/api/v1/material-engine-v2/suppliers',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const body = supplierSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'validation_error', details: body.error.flatten() });
      const actor = request.actor!;
      if (!isTenantAdministrator(actor)) {
        return reply.code(403).send({ error: 'supplier_management_requires_tenant_admin' });
      }
      const result = await withTenant(actor.tenantId, async (tx) => {
        const rows = await tx.$queryRaw<SupplierRow[]>(Prisma.sql`
          INSERT INTO suppliers (tenant_id, code, name, tax_id, email, phone, updated_at)
          VALUES (${actor.tenantId}::uuid, ${body.data.code.toUpperCase()}, ${body.data.name},
                  ${body.data.taxId ?? null}, ${body.data.email ?? null}, ${body.data.phone ?? null},
                  CURRENT_TIMESTAMP)
          ON CONFLICT (tenant_id, code)
          DO UPDATE SET name = EXCLUDED.name, tax_id = EXCLUDED.tax_id,
                        email = EXCLUDED.email, phone = EXCLUDED.phone,
                        is_active = true, updated_at = CURRENT_TIMESTAMP
          RETURNING id, code, name, tax_id, email, phone, is_active
        `);
        return rows[0]!;
      });
      return reply.code(201).send({
        id: result.id,
        code: result.code,
        name: result.name,
        taxId: result.tax_id,
        email: result.email,
        phone: result.phone,
        isActive: result.is_active,
      });
    },
  );

  app.post(
    '/api/v1/material-engine-v2/backfill',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const body = backfillSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'validation_error', details: body.error.flatten() });
      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        if (!(await canManageWorkspace(tx, actor, body.data.workspaceId))) {
          return { kind: 'forbidden' as const };
        }
        const objects = await tx.nexusObject.findMany({
          where: {
            tenantId: actor.tenantId,
            workspaceId: body.data.workspaceId,
            objectTypeKey: 'MATERIAL',
            deletedAt: null,
          },
          select: { id: true, title: true, metadata: true },
          orderBy: { createdAt: 'asc' },
        });
        const existing = await tx.$queryRaw<Array<{ material_object_id: string }>>(Prisma.sql`
          SELECT material_object_id FROM material_masters
          WHERE tenant_id = ${actor.tenantId}::uuid
            AND workspace_id = ${body.data.workspaceId}::uuid
        `);
        const existingIds = new Set(existing.map((row) => row.material_object_id));
        const missing = objects.filter((object) => !existingIds.has(object.id));
        if (body.data.dryRun) {
          return {
            kind: 'ok' as const,
            payload: { dryRun: true, totalMaterialObjects: objects.length, planned: missing.length, created: 0 },
          };
        }

        const uom = await upsertUom(tx, actor.tenantId, 'UND', 'Unidad', 2);
        let created = 0;
        for (let index = 0; index < missing.length; index += 1) {
          const object = missing[index]!;
          const metadata = object.metadata && typeof object.metadata === 'object' && !Array.isArray(object.metadata)
            ? object.metadata as Record<string, Prisma.JsonValue>
            : {};
          const custom = metadata.customFields && typeof metadata.customFields === 'object' && !Array.isArray(metadata.customFields)
            ? metadata.customFields as Record<string, Prisma.JsonValue>
            : {};
          const legacyCode = typeof custom.materialCode === 'string' && custom.materialCode.trim()
            ? custom.materialCode.trim()
            : `MAT-${String(index + 1).padStart(4, '0')}`;
          const unitCost = typeof custom.unitCost === 'number' && Number.isFinite(custom.unitCost)
            ? Math.max(0, custom.unitCost)
            : 0;
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO material_masters
              (tenant_id, workspace_id, material_object_id, code, base_uom_id,
               unit_cost, currency, is_active, updated_at)
            VALUES
              (${actor.tenantId}::uuid, ${body.data.workspaceId}::uuid, ${object.id}::uuid,
               ${legacyCode}, ${uom.id}::uuid, ${unitCost}, 'USD', true, CURRENT_TIMESTAMP)
            ON CONFLICT (material_object_id) DO NOTHING
          `);
          created += 1;
        }
        return {
          kind: 'ok' as const,
          payload: { dryRun: false, totalMaterialObjects: objects.length, planned: missing.length, created },
        };
      });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'material_management_denied' });
      return result.payload;
    },
  );
}
