import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canAccessWorkspace, canManageWorkspace } from '../authorization.js';
import { withTenant } from '../tenant-transaction.js';
import {
  costCodeBelongsToWorkspace,
  materialBelongsToWorkspace,
  metadataNumber,
  projectCostCurrency,
  tenantCurrency,
  validProject,
  validWorkItem,
} from './cost-engine-v2-utils.js';

const uuidParams = z.object({ id: z.string().uuid() });
const projectParams = z.object({ projectId: z.string().uuid() });
const workspaceQuery = z.object({ workspaceId: z.string().uuid() });
const currencySchema = z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase());
const nullableUuid = z.string().uuid().nullable().optional();

const costCodeSchema = z.object({
  workspaceId: z.string().uuid(),
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(255),
  category: z.enum(['MATERIAL', 'LABOR', 'EQUIPMENT', 'SERVICE', 'SUBCONTRACT', 'OTHER']).default('OTHER'),
  parentCostCodeId: nullableUuid,
});
const profileSchema = z.object({
  currency: currencySchema,
  contingencyAmount: z.number().min(0).default(0),
});
const budgetLineCreateSchema = z.object({
  costCodeId: z.string().uuid(),
  workItemId: nullableUuid,
  materialId: nullableUuid,
  description: z.string().trim().min(1).max(500),
  plannedAmount: z.number().min(0),
  approvedAmount: z.number().min(0),
  forecastRemainingUncommitted: z.number().min(0).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});
const budgetLinePatchSchema = z.object({
  workItemId: nullableUuid,
  materialId: nullableUuid,
  description: z.string().trim().min(1).max(500).optional(),
  plannedAmount: z.number().min(0).optional(),
  approvedAmount: z.number().min(0).optional(),
  forecastRemainingUncommitted: z.number().min(0).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required.' });
const commitmentCreateSchema = z.object({
  workItemId: nullableUuid,
  costCodeId: nullableUuid,
  supplierId: nullableUuid,
  description: z.string().trim().min(1).max(500),
  amount: z.number().positive(),
  currency: currencySchema,
  sourceType: z.enum(['MANUAL', 'CONTRACT', 'SAP_IMPORT', 'OTHER']).default('MANUAL'),
  sourceReference: z.string().trim().max(255).nullable().optional(),
  committedAt: z.string().datetime().optional(),
  notes: z.string().max(4000).nullable().optional(),
});
const commitmentPatchSchema = z.object({
  releasedAmount: z.number().min(0).optional(),
  status: z.enum(['OPEN', 'CLOSED', 'CANCELLED']).optional(),
  notes: z.string().max(4000).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required.' });
const actualCreateSchema = z.object({
  workItemId: nullableUuid,
  costCodeId: nullableUuid,
  materialId: nullableUuid,
  description: z.string().trim().min(1).max(500),
  amount: z.number().positive(),
  currency: currencySchema,
  sourceType: z.enum(['MANUAL', 'SAP_IMPORT', 'ACCRUAL', 'OTHER']).default('MANUAL'),
  externalReference: z.string().trim().max(255).nullable().optional(),
  occurredAt: z.string().datetime().optional(),
  notes: z.string().max(4000).nullable().optional(),
});
const baselineSchema = z.object({ name: z.string().trim().max(255).nullable().optional() });
const backfillSchema = z.object({ projectId: z.string().uuid(), dryRun: z.boolean().default(true) });

type BudgetRow = {
  id: string;
  workspace_id: string;
  project_object_id: string;
  cost_code_id: string;
  work_item_object_id: string | null;
  material_id: string | null;
  description: string;
  planned_amount: Prisma.Decimal | string | number;
  approved_amount: Prisma.Decimal | string | number;
  forecast_remaining_uncommitted: Prisma.Decimal | string | number | null;
};
type CommitmentRow = {
  id: string;
  workspace_id: string;
  project_object_id: string;
  amount: Prisma.Decimal | string | number;
  released_amount: Prisma.Decimal | string | number;
};

function numberOf(value: Prisma.Decimal | string | number | null | undefined): number {
  return value == null ? 0 : Number(value);
}

export async function costOperationsV2Routes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/cost-engine-v2/catalog',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const query = workspaceQuery.safeParse(request.query);
      if (!query.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        if (!(await canAccessWorkspace(tx, actor, query.data.workspaceId))) return { kind: 'forbidden' as const };
        const [codes, suppliers] = await Promise.all([
          tx.$queryRaw<Array<{ id: string; code: string; name: string; category: string; parent_cost_code_id: string | null }>>(Prisma.sql`
            SELECT id, code, name, category, parent_cost_code_id
            FROM cost_codes
            WHERE tenant_id = ${actor.tenantId}::uuid
              AND workspace_id = ${query.data.workspaceId}::uuid
              AND is_active = true
            ORDER BY code
          `),
          tx.$queryRaw<Array<{ id: string; code: string; name: string }>>(Prisma.sql`
            SELECT id, code, name FROM suppliers
            WHERE tenant_id = ${actor.tenantId}::uuid AND is_active = true
            ORDER BY name
          `),
        ]);
        return { kind: 'ok' as const, payload: { costCodes: codes, suppliers } };
      });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });
      return result.payload;
    },
  );

  app.post(
    '/api/v1/cost-engine-v2/cost-codes',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const body = costCodeSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'validation_error', details: body.error.flatten() });
      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        if (!(await canManageWorkspace(tx, actor, body.data.workspaceId))) return { kind: 'forbidden' as const };
        if (body.data.parentCostCodeId && !(await costCodeBelongsToWorkspace(tx, actor.tenantId, body.data.workspaceId, body.data.parentCostCodeId))) {
          return { kind: 'parent_not_found' as const };
        }
        const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          INSERT INTO cost_codes
            (tenant_id, workspace_id, code, name, category, parent_cost_code_id, updated_at)
          VALUES
            (${actor.tenantId}::uuid, ${body.data.workspaceId}::uuid, ${body.data.code},
             ${body.data.name}, ${body.data.category}, ${body.data.parentCostCodeId ?? null}::uuid,
             CURRENT_TIMESTAMP)
          RETURNING id
        `);
        await tx.domainEvent.create({
          data: {
            tenantId: actor.tenantId,
            aggregateId: rows[0]!.id,
            eventType: 'bridata.cost.code.created',
            payload: { costCodeId: rows[0]!.id, code: body.data.code, actorId: actor.userId },
          },
        });
        return { kind: 'ok' as const, payload: { id: rows[0]!.id, ...body.data } };
      });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'cost_code_management_denied' });
      if (result.kind === 'parent_not_found') return reply.code(404).send({ error: 'parent_cost_code_not_found' });
      return reply.code(201).send(result.payload);
    },
  );

  app.put(
    '/api/v1/projects/:projectId/cost-profile-v2',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = projectParams.safeParse(request.params);
      const body = profileSchema.safeParse(request.body);
      if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const project = await validProject(tx, actor.tenantId, params.data.projectId);
        if (!project) return { kind: 'not_found' as const };
        if (!(await canManageWorkspace(tx, actor, project.workspaceId))) return { kind: 'forbidden' as const };
        const existing = await tx.$queryRaw<Array<{ id: string; currency: string }>>(Prisma.sql`
          SELECT id, currency FROM project_cost_profiles
          WHERE tenant_id = ${actor.tenantId}::uuid AND project_object_id = ${project.id}::uuid
        `);
        if (existing[0] && existing[0].currency !== body.data.currency) {
          const counts = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
            SELECT (
              (SELECT COUNT(*) FROM project_budget_lines WHERE tenant_id = ${actor.tenantId}::uuid AND project_object_id = ${project.id}::uuid) +
              (SELECT COUNT(*) FROM project_commitments WHERE tenant_id = ${actor.tenantId}::uuid AND project_object_id = ${project.id}::uuid) +
              (SELECT COUNT(*) FROM project_actual_costs WHERE tenant_id = ${actor.tenantId}::uuid AND project_object_id = ${project.id}::uuid) +
              (SELECT COUNT(*) FROM project_cost_baselines WHERE tenant_id = ${actor.tenantId}::uuid AND project_object_id = ${project.id}::uuid)
            ) AS count
          `);
          if (Number(counts[0]?.count ?? 0) > 0) return { kind: 'currency_locked' as const };
        }
        const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          INSERT INTO project_cost_profiles
            (tenant_id, workspace_id, project_object_id, currency, contingency_amount, updated_at)
          VALUES
            (${actor.tenantId}::uuid, ${project.workspaceId}::uuid, ${project.id}::uuid,
             ${body.data.currency}, ${body.data.contingencyAmount}, CURRENT_TIMESTAMP)
          ON CONFLICT (project_object_id) DO UPDATE SET
            currency = EXCLUDED.currency,
            contingency_amount = EXCLUDED.contingency_amount,
            updated_at = CURRENT_TIMESTAMP
          RETURNING id
        `);
        return { kind: 'ok' as const, payload: { id: rows[0]!.id, projectId: project.id, ...body.data } };
      });
      if (result.kind === 'not_found') return reply.code(404).send({ error: 'project_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'cost_profile_management_denied' });
      if (result.kind === 'currency_locked') return reply.code(409).send({ error: 'project_cost_currency_locked' });
      return result.payload;
    },
  );

  app.post(
    '/api/v1/projects/:projectId/budget-lines-v2',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = projectParams.safeParse(request.params);
      const body = budgetLineCreateSchema.safeParse(request.body);
      if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const project = await validProject(tx, actor.tenantId, params.data.projectId);
        if (!project) return { kind: 'not_found' as const };
        if (!(await canManageWorkspace(tx, actor, project.workspaceId))) return { kind: 'forbidden' as const };
        if (!(await costCodeBelongsToWorkspace(tx, actor.tenantId, project.workspaceId, body.data.costCodeId))) return { kind: 'cost_code_not_found' as const };
        if (!(await validWorkItem(tx, actor.tenantId, project.workspaceId, project.id, body.data.workItemId))) return { kind: 'work_item_not_found' as const };
        if (!(await materialBelongsToWorkspace(tx, actor.tenantId, project.workspaceId, body.data.materialId))) return { kind: 'material_not_found' as const };
        const profile = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id FROM project_cost_profiles
          WHERE tenant_id = ${actor.tenantId}::uuid AND project_object_id = ${project.id}::uuid
        `);
        if (!profile[0]) return { kind: 'profile_required' as const };
        const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          INSERT INTO project_budget_lines
            (tenant_id, workspace_id, project_object_id, work_item_object_id, cost_code_id,
             material_id, description, planned_amount, approved_amount,
             forecast_remaining_uncommitted, notes, updated_at)
          VALUES
            (${actor.tenantId}::uuid, ${project.workspaceId}::uuid, ${project.id}::uuid,
             ${body.data.workItemId ?? null}::uuid, ${body.data.costCodeId}::uuid,
             ${body.data.materialId ?? null}::uuid, ${body.data.description}, ${body.data.plannedAmount},
             ${body.data.approvedAmount}, ${body.data.forecastRemainingUncommitted ?? null},
             ${body.data.notes ?? null}, CURRENT_TIMESTAMP)
          RETURNING id
        `);
        await tx.domainEvent.create({
          data: {
            tenantId: actor.tenantId,
            aggregateId: project.id,
            eventType: 'bridata.cost.budget_line.created',
            payload: { projectId: project.id, budgetLineId: rows[0]!.id, actorId: actor.userId },
          },
        });
        return { kind: 'ok' as const, payload: { id: rows[0]!.id, projectId: project.id, ...body.data } };
      });
      if (result.kind === 'not_found') return reply.code(404).send({ error: 'project_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'budget_management_denied' });
      if (result.kind === 'cost_code_not_found') return reply.code(404).send({ error: 'cost_code_not_found' });
      if (result.kind === 'work_item_not_found') return reply.code(404).send({ error: 'work_item_not_found' });
      if (result.kind === 'material_not_found') return reply.code(404).send({ error: 'material_master_not_found' });
      if (result.kind === 'profile_required') return reply.code(409).send({ error: 'project_cost_profile_required' });
      return reply.code(201).send(result.payload);
    },
  );

  app.patch(
    '/api/v1/cost-engine-v2/budget-lines/:id',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = uuidParams.safeParse(request.params);
      const body = budgetLinePatchSchema.safeParse(request.body);
      if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const rows = await tx.$queryRaw<BudgetRow[]>(Prisma.sql`
          SELECT id, workspace_id, project_object_id, cost_code_id, work_item_object_id,
                 material_id, description, planned_amount, approved_amount,
                 forecast_remaining_uncommitted
          FROM project_budget_lines
          WHERE id = ${params.data.id}::uuid AND tenant_id = ${actor.tenantId}::uuid
        `);
        const line = rows[0];
        if (!line) return { kind: 'not_found' as const };
        if (!(await canManageWorkspace(tx, actor, line.workspace_id))) return { kind: 'forbidden' as const };
        if (body.data.workItemId !== undefined && !(await validWorkItem(tx, actor.tenantId, line.workspace_id, line.project_object_id, body.data.workItemId))) return { kind: 'work_item_not_found' as const };
        if (body.data.materialId !== undefined && !(await materialBelongsToWorkspace(tx, actor.tenantId, line.workspace_id, body.data.materialId))) return { kind: 'material_not_found' as const };
        await tx.$executeRaw(Prisma.sql`
          UPDATE project_budget_lines SET
            work_item_object_id = ${body.data.workItemId !== undefined ? body.data.workItemId : line.work_item_object_id}::uuid,
            material_id = ${body.data.materialId !== undefined ? body.data.materialId : line.material_id}::uuid,
            description = ${body.data.description ?? line.description},
            planned_amount = ${body.data.plannedAmount ?? numberOf(line.planned_amount)},
            approved_amount = ${body.data.approvedAmount ?? numberOf(line.approved_amount)},
            forecast_remaining_uncommitted = ${body.data.forecastRemainingUncommitted !== undefined ? body.data.forecastRemainingUncommitted : line.forecast_remaining_uncommitted},
            notes = CASE WHEN ${body.data.notes !== undefined} THEN ${body.data.notes ?? null} ELSE notes END,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ${line.id}::uuid AND tenant_id = ${actor.tenantId}::uuid
        `);
        return { kind: 'ok' as const, payload: { id: line.id } };
      });
      if (result.kind === 'not_found') return reply.code(404).send({ error: 'budget_line_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'budget_management_denied' });
      if (result.kind === 'work_item_not_found') return reply.code(404).send({ error: 'work_item_not_found' });
      if (result.kind === 'material_not_found') return reply.code(404).send({ error: 'material_master_not_found' });
      return result.payload;
    },
  );

  app.post(
    '/api/v1/projects/:projectId/commitments-v2',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = projectParams.safeParse(request.params);
      const body = commitmentCreateSchema.safeParse(request.body);
      if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const project = await validProject(tx, actor.tenantId, params.data.projectId);
        if (!project) return { kind: 'not_found' as const };
        if (!(await canManageWorkspace(tx, actor, project.workspaceId))) return { kind: 'forbidden' as const };
        const currency = await projectCostCurrency(tx, actor.tenantId, project.id);
        if (currency !== body.data.currency) return { kind: 'currency_mismatch' as const, currency };
        if (!(await validWorkItem(tx, actor.tenantId, project.workspaceId, project.id, body.data.workItemId))) return { kind: 'work_item_not_found' as const };
        if (!(await costCodeBelongsToWorkspace(tx, actor.tenantId, project.workspaceId, body.data.costCodeId))) return { kind: 'cost_code_not_found' as const };
        const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          INSERT INTO project_commitments
            (tenant_id, workspace_id, project_object_id, work_item_object_id, cost_code_id,
             supplier_id, description, amount, currency, source_type, source_reference,
             committed_at, notes, updated_at)
          VALUES
            (${actor.tenantId}::uuid, ${project.workspaceId}::uuid, ${project.id}::uuid,
             ${body.data.workItemId ?? null}::uuid, ${body.data.costCodeId ?? null}::uuid,
             ${body.data.supplierId ?? null}::uuid, ${body.data.description}, ${body.data.amount},
             ${body.data.currency}, ${body.data.sourceType}, ${body.data.sourceReference ?? null},
             ${body.data.committedAt ? new Date(body.data.committedAt) : new Date()},
             ${body.data.notes ?? null}, CURRENT_TIMESTAMP)
          RETURNING id
        `);
        await tx.domainEvent.create({
          data: {
            tenantId: actor.tenantId,
            aggregateId: rows[0]!.id,
            eventType: 'bridata.cost.commitment.created',
            payload: { projectId: project.id, commitmentId: rows[0]!.id, amount: body.data.amount, actorId: actor.userId },
          },
        });
        return { kind: 'ok' as const, payload: { id: rows[0]!.id, projectId: project.id, ...body.data, status: 'OPEN' } };
      });
      if (result.kind === 'not_found') return reply.code(404).send({ error: 'project_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'commitment_management_denied' });
      if (result.kind === 'currency_mismatch') return reply.code(409).send({ error: 'cost_currency_mismatch', expectedCurrency: result.currency });
      if (result.kind === 'work_item_not_found') return reply.code(404).send({ error: 'work_item_not_found' });
      if (result.kind === 'cost_code_not_found') return reply.code(404).send({ error: 'cost_code_not_found' });
      return reply.code(201).send(result.payload);
    },
  );

  app.patch(
    '/api/v1/cost-engine-v2/commitments/:id',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = uuidParams.safeParse(request.params);
      const body = commitmentPatchSchema.safeParse(request.body);
      if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const rows = await tx.$queryRaw<CommitmentRow[]>(Prisma.sql`
          SELECT id, workspace_id, project_object_id, amount, released_amount
          FROM project_commitments
          WHERE id = ${params.data.id}::uuid AND tenant_id = ${actor.tenantId}::uuid
        `);
        const current = rows[0];
        if (!current) return { kind: 'not_found' as const };
        if (!(await canManageWorkspace(tx, actor, current.workspace_id))) return { kind: 'forbidden' as const };
        const released = body.data.releasedAmount ?? numberOf(current.released_amount);
        if (released > numberOf(current.amount) + 0.000001) return { kind: 'over_release' as const };
        await tx.$executeRaw(Prisma.sql`
          UPDATE project_commitments SET
            released_amount = ${released},
            status = ${body.data.status ?? (released >= numberOf(current.amount) ? 'CLOSED' : 'OPEN')},
            notes = CASE WHEN ${body.data.notes !== undefined} THEN ${body.data.notes ?? null} ELSE notes END,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ${current.id}::uuid AND tenant_id = ${actor.tenantId}::uuid
        `);
        return { kind: 'ok' as const, payload: { id: current.id, releasedAmount: released } };
      });
      if (result.kind === 'not_found') return reply.code(404).send({ error: 'commitment_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'commitment_management_denied' });
      if (result.kind === 'over_release') return reply.code(409).send({ error: 'released_amount_exceeds_commitment' });
      return result.payload;
    },
  );

  app.post(
    '/api/v1/projects/:projectId/actual-costs-v2',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = projectParams.safeParse(request.params);
      const body = actualCreateSchema.safeParse(request.body);
      if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const project = await validProject(tx, actor.tenantId, params.data.projectId);
        if (!project) return { kind: 'not_found' as const };
        if (!(await canManageWorkspace(tx, actor, project.workspaceId))) return { kind: 'forbidden' as const };
        const currency = await projectCostCurrency(tx, actor.tenantId, project.id);
        if (currency !== body.data.currency) return { kind: 'currency_mismatch' as const, currency };
        if (!(await validWorkItem(tx, actor.tenantId, project.workspaceId, project.id, body.data.workItemId))) return { kind: 'work_item_not_found' as const };
        if (!(await costCodeBelongsToWorkspace(tx, actor.tenantId, project.workspaceId, body.data.costCodeId))) return { kind: 'cost_code_not_found' as const };
        if (!(await materialBelongsToWorkspace(tx, actor.tenantId, project.workspaceId, body.data.materialId))) return { kind: 'material_not_found' as const };
        const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          INSERT INTO project_actual_costs
            (tenant_id, workspace_id, project_object_id, work_item_object_id, cost_code_id,
             material_id, description, amount, currency, source_type, external_reference,
             occurred_at, notes, created_by_user_id)
          VALUES
            (${actor.tenantId}::uuid, ${project.workspaceId}::uuid, ${project.id}::uuid,
             ${body.data.workItemId ?? null}::uuid, ${body.data.costCodeId ?? null}::uuid,
             ${body.data.materialId ?? null}::uuid, ${body.data.description}, ${body.data.amount},
             ${body.data.currency}, ${body.data.sourceType}, ${body.data.externalReference ?? null},
             ${body.data.occurredAt ? new Date(body.data.occurredAt) : new Date()},
             ${body.data.notes ?? null}, ${actor.userId}::uuid)
          RETURNING id
        `);
        await tx.domainEvent.create({
          data: {
            tenantId: actor.tenantId,
            aggregateId: rows[0]!.id,
            eventType: 'bridata.cost.actual.posted',
            payload: { projectId: project.id, actualCostId: rows[0]!.id, amount: body.data.amount, actorId: actor.userId },
          },
        });
        return { kind: 'ok' as const, payload: { id: rows[0]!.id, projectId: project.id, ...body.data } };
      });
      if (result.kind === 'not_found') return reply.code(404).send({ error: 'project_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'actual_cost_management_denied' });
      if (result.kind === 'currency_mismatch') return reply.code(409).send({ error: 'cost_currency_mismatch', expectedCurrency: result.currency });
      if (result.kind === 'work_item_not_found') return reply.code(404).send({ error: 'work_item_not_found' });
      if (result.kind === 'cost_code_not_found') return reply.code(404).send({ error: 'cost_code_not_found' });
      if (result.kind === 'material_not_found') return reply.code(404).send({ error: 'material_master_not_found' });
      return reply.code(201).send(result.payload);
    },
  );

  app.get(
    '/api/v1/projects/:projectId/cost-baselines-v2',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = projectParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const project = await validProject(tx, actor.tenantId, params.data.projectId);
        if (!project) return { kind: 'not_found' as const };
        if (!(await canAccessWorkspace(tx, actor, project.workspaceId))) return { kind: 'forbidden' as const };
        const rows = await tx.$queryRaw<Array<{ id: string; version: number; name: string | null; currency: string; contingency_amount: Prisma.Decimal; captured_at: Date }>>(Prisma.sql`
          SELECT id, version, name, currency, contingency_amount, captured_at
          FROM project_cost_baselines
          WHERE tenant_id = ${actor.tenantId}::uuid AND project_object_id = ${project.id}::uuid
          ORDER BY version DESC
        `);
        return { kind: 'ok' as const, payload: { items: rows.map((row) => ({ ...row, contingency_amount: numberOf(row.contingency_amount) })) } };
      });
      if (result.kind === 'not_found') return reply.code(404).send({ error: 'project_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });
      return result.payload;
    },
  );

  app.post(
    '/api/v1/projects/:projectId/cost-baseline-v2',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = projectParams.safeParse(request.params);
      const body = baselineSchema.safeParse(request.body ?? {});
      if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const project = await validProject(tx, actor.tenantId, params.data.projectId);
        if (!project) return { kind: 'not_found' as const };
        if (!(await canManageWorkspace(tx, actor, project.workspaceId))) return { kind: 'forbidden' as const };
        const profiles = await tx.$queryRaw<Array<{ currency: string; contingency_amount: Prisma.Decimal }>>(Prisma.sql`
          SELECT currency, contingency_amount FROM project_cost_profiles
          WHERE tenant_id = ${actor.tenantId}::uuid AND project_object_id = ${project.id}::uuid
        `);
        const profile = profiles[0];
        if (!profile) return { kind: 'profile_required' as const };
        const versions = await tx.$queryRaw<Array<{ version: number }>>(Prisma.sql`
          SELECT COALESCE(MAX(version), 0) + 1 AS version FROM project_cost_baselines
          WHERE tenant_id = ${actor.tenantId}::uuid AND project_object_id = ${project.id}::uuid
        `);
        const version = Number(versions[0]?.version ?? 1);
        const baselines = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          INSERT INTO project_cost_baselines
            (tenant_id, project_object_id, version, name, currency, contingency_amount,
             captured_by_user_id)
          VALUES
            (${actor.tenantId}::uuid, ${project.id}::uuid, ${version}, ${body.data.name ?? null},
             ${profile.currency}, ${numberOf(profile.contingency_amount)}, ${actor.userId}::uuid)
          RETURNING id
        `);
        const baselineId = baselines[0]!.id;
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO project_cost_baseline_lines
            (tenant_id, baseline_id, budget_line_id, work_item_object_id, cost_code_id,
             material_id, description, planned_amount, approved_amount,
             forecast_remaining_uncommitted)
          SELECT tenant_id, ${baselineId}::uuid, id, work_item_object_id, cost_code_id,
                 material_id, description, planned_amount, approved_amount,
                 forecast_remaining_uncommitted
          FROM project_budget_lines
          WHERE tenant_id = ${actor.tenantId}::uuid AND project_object_id = ${project.id}::uuid
        `);
        const counts = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
          SELECT COUNT(*) AS count FROM project_cost_baseline_lines
          WHERE tenant_id = ${actor.tenantId}::uuid AND baseline_id = ${baselineId}::uuid
        `);
        await tx.domainEvent.create({
          data: {
            tenantId: actor.tenantId,
            aggregateId: project.id,
            eventType: 'bridata.cost.baseline.captured',
            payload: { projectId: project.id, baselineId, version, lineCount: Number(counts[0]?.count ?? 0), actorId: actor.userId },
          },
        });
        return { kind: 'ok' as const, payload: { id: baselineId, projectId: project.id, version, lineCount: Number(counts[0]?.count ?? 0) } };
      });
      if (result.kind === 'not_found') return reply.code(404).send({ error: 'project_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'cost_baseline_denied' });
      if (result.kind === 'profile_required') return reply.code(409).send({ error: 'project_cost_profile_required' });
      return reply.code(201).send(result.payload);
    },
  );

  app.post(
    '/api/v1/cost-engine-v2/backfill',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const body = backfillSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const project = await validProject(tx, actor.tenantId, body.data.projectId);
        if (!project) return { kind: 'not_found' as const };
        if (!(await canManageWorkspace(tx, actor, project.workspaceId))) return { kind: 'forbidden' as const };
        const legacyBudget = metadataNumber(project.metadata, 'budgetTotal') ?? 0;
        const legacySpent = metadataNumber(project.metadata, 'budgetSpent') ?? 0;
        const tenant = await tx.tenant.findUnique({ where: { id: actor.tenantId }, select: { metadata: true } });
        const currency = tenantCurrency(tenant?.metadata ?? null);
        const existingProfiles = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id FROM project_cost_profiles WHERE tenant_id = ${actor.tenantId}::uuid AND project_object_id = ${project.id}::uuid
        `);
        const existingLines = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
          SELECT COUNT(*) AS count FROM project_budget_lines WHERE tenant_id = ${actor.tenantId}::uuid AND project_object_id = ${project.id}::uuid
        `);
        const existingLegacyActual = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id FROM project_actual_costs
          WHERE tenant_id = ${actor.tenantId}::uuid AND project_object_id = ${project.id}::uuid
            AND source_type = 'LEGACY_METADATA' AND external_reference = 'budgetSpent'
        `);
        const plan = {
          createProfile: !existingProfiles[0],
          createBudgetLine: legacyBudget > 0 && Number(existingLines[0]?.count ?? 0) === 0,
          createLegacyActual: legacySpent > 0 && !existingLegacyActual[0],
          legacyBudget,
          legacySpent,
          currency,
        };
        if (body.data.dryRun) return { kind: 'ok' as const, payload: { projectId: project.id, dryRun: true, ...plan } };

        if (plan.createProfile) {
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO project_cost_profiles
              (tenant_id, workspace_id, project_object_id, currency, contingency_amount, updated_at)
            VALUES (${actor.tenantId}::uuid, ${project.workspaceId}::uuid, ${project.id}::uuid, ${currency}, 0, CURRENT_TIMESTAMP)
          `);
        }
        let legacyCode = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id FROM cost_codes
          WHERE tenant_id = ${actor.tenantId}::uuid AND workspace_id = ${project.workspaceId}::uuid
            AND code = 'LEGACY-GENERAL'
        `);
        if ((plan.createBudgetLine || plan.createLegacyActual) && !legacyCode[0]) {
          legacyCode = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            INSERT INTO cost_codes
              (tenant_id, workspace_id, code, name, category, updated_at)
            VALUES (${actor.tenantId}::uuid, ${project.workspaceId}::uuid, 'LEGACY-GENERAL',
                    'Presupuesto legado', 'OTHER', CURRENT_TIMESTAMP)
            RETURNING id
          `);
        }
        if (plan.createBudgetLine) {
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO project_budget_lines
              (tenant_id, workspace_id, project_object_id, cost_code_id, description,
               planned_amount, approved_amount, updated_at)
            VALUES (${actor.tenantId}::uuid, ${project.workspaceId}::uuid, ${project.id}::uuid,
                    ${legacyCode[0]!.id}::uuid, 'Presupuesto migrado desde NexusObject metadata',
                    ${legacyBudget}, ${legacyBudget}, CURRENT_TIMESTAMP)
          `);
        }
        if (plan.createLegacyActual) {
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO project_actual_costs
              (tenant_id, workspace_id, project_object_id, cost_code_id, description,
               amount, currency, source_type, external_reference, created_by_user_id)
            VALUES (${actor.tenantId}::uuid, ${project.workspaceId}::uuid, ${project.id}::uuid,
                    ${legacyCode[0]!.id}::uuid, 'Costo migrado desde budgetSpent', ${legacySpent},
                    ${currency}, 'LEGACY_METADATA', 'budgetSpent', ${actor.userId}::uuid)
          `);
        }
        return { kind: 'ok' as const, payload: { projectId: project.id, dryRun: false, ...plan } };
      });
      if (result.kind === 'not_found') return reply.code(404).send({ error: 'project_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'cost_backfill_denied' });
      return result.payload;
    },
  );
}