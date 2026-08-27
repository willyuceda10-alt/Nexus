import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor, type ActorContext } from '../auth.js';
import { authorizePermission, isTenantAdministrator } from '../authorization.js';
import {
  AutomationValidationErrorV1,
  validateAutomationVersionV1,
  type AutomationActionV1,
  type AutomationConditionV1,
} from '../domain/automation-engine-v1.js';
import { withTenant } from '../tenant-transaction.js';

const uuid = z.string().uuid();
const listQuerySchema = z.object({
  workspaceId: uuid.optional(),
  projectId: uuid.optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']).optional(),
});
const definitionCreateSchema = z.object({
  workspaceId: uuid.nullable().optional(),
  projectId: uuid.nullable().optional(),
  name: z.string().trim().min(1).max(255),
  description: z.string().max(4000).nullable().optional(),
  maxRunsPerHour: z.number().int().min(1).max(10000).default(100),
  maxDepth: z.number().int().min(1).max(10).default(5),
});
const idParamsSchema = z.object({ id: uuid });
const statusSchema = z.object({ status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']) });
const valueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('LITERAL'), value: z.union([z.string(), z.number(), z.boolean(), z.null()]) }),
  z.object({ kind: z.literal('EVENT_PATH'), path: z.string().trim().min(1).max(500) }),
]);
const conditionSchema: z.ZodType<AutomationConditionV1> = z.lazy(() => z.union([
  z.object({
    kind: z.literal('GROUP'),
    operator: z.enum(['AND', 'OR']),
    conditions: z.array(conditionSchema).min(1).max(20),
  }),
  z.object({
    kind: z.literal('PREDICATE'),
    left: valueSchema,
    operator: z.enum(['EQ', 'NEQ', 'GT', 'GTE', 'LT', 'LTE', 'IN', 'NOT_IN', 'CONTAINS', 'EXISTS']),
    right: valueSchema.optional(),
  }),
]));
const actionSchema: z.ZodType<AutomationActionV1> = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('EMIT_EVENT'),
    eventType: z.string().trim().min(1).max(150),
    aggregateId: valueSchema.optional(),
    payload: z.record(valueSchema).optional(),
  }),
  z.object({
    type: z.literal('CREATE_TASK'),
    title: valueSchema,
    description: valueSchema.optional(),
    projectId: valueSchema.optional(),
    workspaceId: valueSchema.optional(),
    assigneeId: valueSchema.optional(),
    dueDate: valueSchema.optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  }),
  z.object({
    type: z.literal('REQUEST_APPROVAL'),
    title: valueSchema,
    description: valueSchema.optional(),
    approverUserId: valueSchema.optional(),
  }),
]);
const versionSchema = z.object({
  triggerEventType: z.string().trim().min(1).max(150),
  condition: conditionSchema.nullable().optional(),
  actions: z.array(actionSchema).min(1).max(10),
  changeNote: z.string().max(4000).nullable().optional(),
  activate: z.boolean().default(true),
});
const runsQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });
const approvalQuerySchema = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).default('PENDING') });
const approvalDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  comment: z.string().max(4000).nullable().optional(),
});

type DefinitionRow = {
  id: string;
  workspace_id: string | null;
  project_object_id: string | null;
  name: string;
  description: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
  active_version: number | null;
  max_runs_per_hour: number;
  max_depth: number;
  created_by_user_id: string;
  created_at: Date;
  updated_at: Date;
};

type VersionRow = {
  id: string;
  definition_id: string;
  version: number;
  trigger_event_type: string;
  condition_dsl: Prisma.JsonValue | null;
  actions: Prisma.JsonValue;
  change_note: string | null;
  created_by_user_id: string;
  created_at: Date;
};

type RunRow = {
  id: string;
  definition_id: string;
  version_id: string;
  source_event_id: string;
  source_event_type: string;
  root_event_id: string;
  depth: number;
  status: string;
  attempts: number;
  started_at: Date;
  finished_at: Date | null;
  last_error: string | null;
  created_at: Date;
};

type ApprovalRow = {
  id: string;
  run_id: string;
  step_index: number;
  automation_definition_id: string;
  approver_user_id: string | null;
  title: string;
  description: string | null;
  status: string;
  decision_by_user_id: string | null;
  decision_comment: string | null;
  decided_at: Date | null;
  created_at: Date;
};

function serializeDefinition(row: DefinitionRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_object_id,
    name: row.name,
    description: row.description,
    status: row.status,
    activeVersion: row.active_version,
    maxRunsPerHour: row.max_runs_per_hour,
    maxDepth: row.max_depth,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function serializeVersion(row: VersionRow) {
  return {
    id: row.id,
    definitionId: row.definition_id,
    version: row.version,
    triggerEventType: row.trigger_event_type,
    condition: row.condition_dsl,
    actions: row.actions,
    changeNote: row.change_note,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at.toISOString(),
  };
}

async function resolveScope(
  tx: Prisma.TransactionClient,
  tenantId: string,
  workspaceId?: string | null,
  projectId?: string | null,
): Promise<{ workspaceId: string | null; projectId: string | null } | null> {
  if (projectId) {
    const project = await tx.nexusObject.findFirst({
      where: { id: projectId, tenantId, objectTypeKey: 'PROJECT', deletedAt: null },
      select: { workspaceId: true },
    });
    if (!project || (workspaceId && workspaceId !== project.workspaceId)) return null;
    return { workspaceId: project.workspaceId, projectId };
  }
  if (workspaceId) {
    const workspace = await tx.workspace.findFirst({ where: { id: workspaceId, tenantId }, select: { id: true } });
    if (!workspace) return null;
    return { workspaceId, projectId: null };
  }
  return { workspaceId: null, projectId: null };
}

async function canManageAutomationScope(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  scope: { workspaceId: string | null; projectId: string | null },
): Promise<boolean> {
  if (!scope.workspaceId) {
    return (await authorizePermission(tx, actor, 'tenant.manage_automation')).allowed;
  }
  return (await authorizePermission(tx, actor, 'workspace.manage_automation', {
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
  })).allowed;
}

async function definitionById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<DefinitionRow | null> {
  const rows = await tx.$queryRaw<DefinitionRow[]>(Prisma.sql`
    SELECT id, workspace_id, project_object_id, name, description, status, active_version,
           max_runs_per_hour, max_depth, created_by_user_id, created_at, updated_at
    FROM automation_definitions_v1
    WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid
  `);
  return rows[0] ?? null;
}

export async function automationV1Routes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/automations-v1', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;
    const result = await withTenant(actor.tenantId, async (tx) => {
      const scope = await resolveScope(tx, actor.tenantId, query.data.workspaceId, query.data.projectId);
      if (!scope) return { kind: 'not_found' as const };
      if (!(await canManageAutomationScope(tx, actor, scope))) return { kind: 'forbidden' as const };
      const rows = await tx.$queryRaw<DefinitionRow[]>(Prisma.sql`
        SELECT id, workspace_id, project_object_id, name, description, status, active_version,
               max_runs_per_hour, max_depth, created_by_user_id, created_at, updated_at
        FROM automation_definitions_v1
        WHERE tenant_id = ${actor.tenantId}::uuid
          AND (${scope.workspaceId}::uuid IS NULL OR workspace_id = ${scope.workspaceId}::uuid)
          AND (${scope.projectId}::uuid IS NULL OR project_object_id = ${scope.projectId}::uuid)
          AND (${query.data.status ?? null}::text IS NULL OR status = ${query.data.status ?? null})
        ORDER BY updated_at DESC, name
      `);
      return { kind: 'ok' as const, rows };
    });
    if (result.kind === 'not_found') return reply.code(404).send({ error: 'automation_scope_not_found' });
    if (result.kind === 'forbidden') return reply.code(403).send({ error: 'automation_management_denied' });
    return { items: result.rows.map(serializeDefinition) };
  });

  app.post('/api/v1/automations-v1', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const body = definitionCreateSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'validation_error', details: body.error.flatten() });
    const actor = request.actor!;
    const result = await withTenant(actor.tenantId, async (tx) => {
      const scope = await resolveScope(tx, actor.tenantId, body.data.workspaceId, body.data.projectId);
      if (!scope) return { kind: 'not_found' as const };
      if (!(await canManageAutomationScope(tx, actor, scope))) return { kind: 'forbidden' as const };
      const rows = await tx.$queryRaw<DefinitionRow[]>(Prisma.sql`
        INSERT INTO automation_definitions_v1
          (tenant_id, workspace_id, project_object_id, name, description, status,
           max_runs_per_hour, max_depth, created_by_user_id, updated_by_user_id)
        VALUES
          (${actor.tenantId}::uuid, ${scope.workspaceId}::uuid, ${scope.projectId}::uuid,
           ${body.data.name}, ${body.data.description ?? null}, 'DRAFT',
           ${body.data.maxRunsPerHour}, ${body.data.maxDepth}, ${actor.userId}::uuid, ${actor.userId}::uuid)
        RETURNING id, workspace_id, project_object_id, name, description, status, active_version,
                  max_runs_per_hour, max_depth, created_by_user_id, created_at, updated_at
      `);
      const row = rows[0]!;
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          userId: actor.userId,
          action: 'AUTOMATION_CREATED',
          resource: 'AUTOMATION',
          resourceId: row.id,
          correlationId: request.id,
          ipAddress: request.ip,
          details: { workspaceId: scope.workspaceId, projectId: scope.projectId, name: row.name },
        },
      });
      return { kind: 'ok' as const, row };
    });
    if (result.kind === 'not_found') return reply.code(404).send({ error: 'automation_scope_not_found' });
    if (result.kind === 'forbidden') return reply.code(403).send({ error: 'automation_management_denied' });
    return reply.code(201).send(serializeDefinition(result.row));
  });

  app.post('/api/v1/automations-v1/:id/versions', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    const body = versionSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });

    try {
      validateAutomationVersionV1({
        triggerEventType: body.data.triggerEventType,
        condition: body.data.condition,
        actions: body.data.actions,
      });
    } catch (error) {
      if (error instanceof AutomationValidationErrorV1) {
        return reply.code(400).send({ error: 'invalid_automation', message: error.message });
      }
      throw error;
    }

    const actor = request.actor!;
    const result = await withTenant(actor.tenantId, async (tx) => {
      const definition = await definitionById(tx, actor.tenantId, params.data.id);
      if (!definition) return { kind: 'not_found' as const };
      const scope = { workspaceId: definition.workspace_id, projectId: definition.project_object_id };
      if (!(await canManageAutomationScope(tx, actor, scope))) return { kind: 'forbidden' as const };

      const versionRows = await tx.$queryRaw<Array<{ next_version: number }>>(Prisma.sql`
        SELECT COALESCE(MAX(version), 0) + 1 AS next_version
        FROM automation_versions_v1
        WHERE tenant_id = ${actor.tenantId}::uuid AND definition_id = ${definition.id}::uuid
      `);
      const version = Number(versionRows[0]?.next_version ?? 1);
      const inserted = await tx.$queryRaw<VersionRow[]>(Prisma.sql`
        INSERT INTO automation_versions_v1
          (tenant_id, definition_id, version, trigger_event_type, condition_dsl, actions,
           change_note, created_by_user_id)
        VALUES
          (${actor.tenantId}::uuid, ${definition.id}::uuid, ${version}, ${body.data.triggerEventType},
           ${JSON.stringify(body.data.condition ?? null)}::jsonb,
           ${JSON.stringify(body.data.actions)}::jsonb,
           ${body.data.changeNote ?? null}, ${actor.userId}::uuid)
        RETURNING id, definition_id, version, trigger_event_type, condition_dsl, actions,
                  change_note, created_by_user_id, created_at
      `);
      const row = inserted[0]!;
      if (body.data.activate) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE automation_definitions_v1
          SET active_version = ${version}, status = 'ACTIVE', updated_by_user_id = ${actor.userId}::uuid,
              updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${definition.id}::uuid
        `);
      }
      await Promise.all([
        tx.domainEvent.create({
          data: {
            tenantId: actor.tenantId,
            aggregateId: definition.id,
            eventType: 'bridata.automation.version.published',
            idempotencyKey: `automation-version:${row.id}`,
            payload: {
              automationId: definition.id,
              version,
              triggerEventType: body.data.triggerEventType,
              activated: body.data.activate,
              workspaceId: definition.workspace_id,
              projectId: definition.project_object_id,
              actorId: actor.userId,
            },
          },
        }),
        tx.auditLog.create({
          data: {
            tenantId: actor.tenantId,
            userId: actor.userId,
            action: body.data.activate ? 'AUTOMATION_VERSION_PUBLISHED_AND_ACTIVATED' : 'AUTOMATION_VERSION_PUBLISHED',
            resource: 'AUTOMATION',
            resourceId: definition.id,
            correlationId: request.id,
            ipAddress: request.ip,
            details: { version, triggerEventType: body.data.triggerEventType },
          },
        }),
      ]);
      return { kind: 'ok' as const, row };
    });
    if (result.kind === 'not_found') return reply.code(404).send({ error: 'automation_not_found' });
    if (result.kind === 'forbidden') return reply.code(403).send({ error: 'automation_management_denied' });
    return reply.code(201).send(serializeVersion(result.row));
  });

  app.patch('/api/v1/automations-v1/:id/status', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    const body = statusSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;
    const result = await withTenant(actor.tenantId, async (tx) => {
      const definition = await definitionById(tx, actor.tenantId, params.data.id);
      if (!definition) return { kind: 'not_found' as const };
      if (!(await canManageAutomationScope(tx, actor, { workspaceId: definition.workspace_id, projectId: definition.project_object_id }))) {
        return { kind: 'forbidden' as const };
      }
      if (body.data.status === 'ACTIVE' && !definition.active_version) return { kind: 'no_version' as const };
      const rows = await tx.$queryRaw<DefinitionRow[]>(Prisma.sql`
        UPDATE automation_definitions_v1
        SET status = ${body.data.status}, updated_by_user_id = ${actor.userId}::uuid, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${definition.id}::uuid
        RETURNING id, workspace_id, project_object_id, name, description, status, active_version,
                  max_runs_per_hour, max_depth, created_by_user_id, created_at, updated_at
      `);
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          userId: actor.userId,
          action: 'AUTOMATION_STATUS_CHANGED',
          resource: 'AUTOMATION',
          resourceId: definition.id,
          correlationId: request.id,
          ipAddress: request.ip,
          details: { previousStatus: definition.status, status: body.data.status },
        },
      });
      return { kind: 'ok' as const, row: rows[0]! };
    });
    if (result.kind === 'not_found') return reply.code(404).send({ error: 'automation_not_found' });
    if (result.kind === 'forbidden') return reply.code(403).send({ error: 'automation_management_denied' });
    if (result.kind === 'no_version') return reply.code(409).send({ error: 'automation_active_version_required' });
    return serializeDefinition(result.row);
  });

  app.get('/api/v1/automations-v1/:id/runs', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    const query = runsQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;
    const result = await withTenant(actor.tenantId, async (tx) => {
      const definition = await definitionById(tx, actor.tenantId, params.data.id);
      if (!definition) return { kind: 'not_found' as const };
      if (!(await canManageAutomationScope(tx, actor, { workspaceId: definition.workspace_id, projectId: definition.project_object_id }))) {
        return { kind: 'forbidden' as const };
      }
      const rows = await tx.$queryRaw<RunRow[]>(Prisma.sql`
        SELECT id, definition_id, version_id, source_event_id, source_event_type, root_event_id,
               depth, status, attempts, started_at, finished_at, last_error, created_at
        FROM automation_runs_v1
        WHERE tenant_id = ${actor.tenantId}::uuid AND definition_id = ${definition.id}::uuid
        ORDER BY created_at DESC
        LIMIT ${query.data.limit}
      `);
      return { kind: 'ok' as const, rows };
    });
    if (result.kind === 'not_found') return reply.code(404).send({ error: 'automation_not_found' });
    if (result.kind === 'forbidden') return reply.code(403).send({ error: 'automation_management_denied' });
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        definitionId: row.definition_id,
        versionId: row.version_id,
        sourceEventId: row.source_event_id,
        sourceEventType: row.source_event_type,
        rootEventId: row.root_event_id,
        depth: row.depth,
        status: row.status,
        attempts: row.attempts,
        startedAt: row.started_at.toISOString(),
        finishedAt: row.finished_at?.toISOString() ?? null,
        lastError: row.last_error,
        createdAt: row.created_at.toISOString(),
      })),
    };
  });

  app.get('/api/v1/automation-approvals-v1', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const query = approvalQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;
    const rows = await withTenant(actor.tenantId, async (tx) => tx.$queryRaw<ApprovalRow[]>(Prisma.sql`
      SELECT id, run_id, step_index, automation_definition_id, approver_user_id, title, description,
             status, decision_by_user_id, decision_comment, decided_at, created_at
      FROM automation_approval_requests_v1
      WHERE tenant_id = ${actor.tenantId}::uuid
        AND status = ${query.data.status}
        AND (approver_user_id IS NULL OR approver_user_id = ${actor.userId}::uuid OR ${isTenantAdministrator(actor)})
      ORDER BY created_at DESC
      LIMIT 100
    `));
    return {
      items: rows.map((row) => ({
        id: row.id,
        runId: row.run_id,
        stepIndex: row.step_index,
        automationDefinitionId: row.automation_definition_id,
        approverUserId: row.approver_user_id,
        title: row.title,
        description: row.description,
        status: row.status,
        decisionByUserId: row.decision_by_user_id,
        decisionComment: row.decision_comment,
        decidedAt: row.decided_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString(),
      })),
    };
  });

  app.post('/api/v1/automation-approvals-v1/:id/decision', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    const body = approvalDecisionSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;
    const result = await withTenant(actor.tenantId, async (tx) => {
      const approvals = await tx.$queryRaw<ApprovalRow[]>(Prisma.sql`
        SELECT id, run_id, step_index, automation_definition_id, approver_user_id, title, description,
               status, decision_by_user_id, decision_comment, decided_at, created_at
        FROM automation_approval_requests_v1
        WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${params.data.id}::uuid
        FOR UPDATE
      `);
      const approval = approvals[0];
      if (!approval) return { kind: 'not_found' as const };
      if (approval.status !== 'PENDING') return { kind: 'already_decided' as const };

      const definition = await definitionById(tx, actor.tenantId, approval.automation_definition_id);
      if (!definition) return { kind: 'not_found' as const };
      const managerAllowed = await canManageAutomationScope(tx, actor, {
        workspaceId: definition.workspace_id,
        projectId: definition.project_object_id,
      });
      if (approval.approver_user_id && approval.approver_user_id !== actor.userId && !managerAllowed) {
        return { kind: 'forbidden' as const };
      }
      if (!approval.approver_user_id && !managerAllowed) return { kind: 'forbidden' as const };

      const updated = await tx.$queryRaw<ApprovalRow[]>(Prisma.sql`
        UPDATE automation_approval_requests_v1
        SET status = ${body.data.decision}, decision_by_user_id = ${actor.userId}::uuid,
            decision_comment = ${body.data.comment ?? null}, decided_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${approval.id}::uuid AND status = 'PENDING'
        RETURNING id, run_id, step_index, automation_definition_id, approver_user_id, title, description,
                  status, decision_by_user_id, decision_comment, decided_at, created_at
      `);
      if (!updated[0]) return { kind: 'already_decided' as const };

      await tx.domainEvent.create({
        data: {
          tenantId: actor.tenantId,
          aggregateId: approval.run_id,
          eventType: 'bridata.automation.approval.resolved',
          idempotencyKey: `automation-approval:${approval.id}:${body.data.decision}`,
          payload: {
            approvalId: approval.id,
            runId: approval.run_id,
            automationId: approval.automation_definition_id,
            stepIndex: approval.step_index,
            decision: body.data.decision,
            actorId: actor.userId,
          },
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          userId: actor.userId,
          action: 'AUTOMATION_APPROVAL_DECIDED',
          resource: 'AUTOMATION_APPROVAL',
          resourceId: approval.id,
          correlationId: request.id,
          ipAddress: request.ip,
          details: { decision: body.data.decision, runId: approval.run_id },
        },
      });
      return { kind: 'ok' as const, row: updated[0]! };
    });
    if (result.kind === 'not_found') return reply.code(404).send({ error: 'automation_approval_not_found' });
    if (result.kind === 'already_decided') return reply.code(409).send({ error: 'automation_approval_already_decided' });
    if (result.kind === 'forbidden') return reply.code(403).send({ error: 'automation_approval_denied' });
    return { id: result.row.id, status: result.row.status, decidedAt: result.row.decided_at?.toISOString() ?? null };
  });
}
