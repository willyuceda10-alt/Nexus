import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { authorizePermission } from '../authorization.js';
import {
  AutomationValidationErrorV1,
  validateAutomationVersionV1,
  type AutomationActionV1,
  type AutomationConditionV1,
} from '../domain/automation-engine-v1.js';
import { withTenant } from '../tenant-transaction.js';

const paramsSchema = z.object({ id: z.string().uuid() });
const scalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const conditionSchema = z.object({
  path: z.string().trim().min(1).max(500),
  operator: z.enum(['EQ', 'NEQ', 'GT', 'GTE', 'LT', 'LTE', 'CONTAINS', 'EXISTS']),
  value: scalarSchema.optional(),
}).optional();
const bodySchema = z.object({
  triggerEventType: z.string().trim().min(1).max(150),
  condition: conditionSchema,
  targetUserId: z.string().uuid(),
  notificationTitle: z.string().trim().min(1).max(500),
  notificationBody: z.string().max(8000).nullable().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  requiresAction: z.boolean().default(false),
  activate: z.boolean().default(true),
  changeNote: z.string().max(4000).nullable().optional(),
});

type DefinitionRow = {
  id: string;
  workspace_id: string | null;
  project_object_id: string | null;
  name: string;
};

type VersionRow = {
  id: string;
  version: number;
  trigger_event_type: string;
  condition_dsl: Prisma.JsonValue | null;
  actions: Prisma.JsonValue;
  created_at: Date;
};

function toCondition(input: z.infer<typeof conditionSchema>): AutomationConditionV1 | null {
  if (!input) return null;
  if (input.operator === 'EXISTS') {
    return {
      kind: 'PREDICATE',
      left: { kind: 'EVENT_PATH', path: input.path },
      operator: 'EXISTS',
    };
  }
  if (input.value === undefined) {
    throw new AutomationValidationErrorV1(`${input.operator} requires a condition value.`);
  }
  return {
    kind: 'PREDICATE',
    left: { kind: 'EVENT_PATH', path: input.path },
    operator: input.operator,
    right: { kind: 'LITERAL', value: input.value },
  };
}

function notificationAction(
  definition: DefinitionRow,
  input: z.infer<typeof bodySchema>,
): AutomationActionV1 {
  const payload: Record<string, { kind: 'LITERAL'; value: string | number | boolean | null }> = {
    targetUserId: { kind: 'LITERAL', value: input.targetUserId },
    notificationTitle: { kind: 'LITERAL', value: input.notificationTitle },
    notificationBody: { kind: 'LITERAL', value: input.notificationBody ?? null },
    priority: { kind: 'LITERAL', value: input.priority },
    requiresAction: { kind: 'LITERAL', value: input.requiresAction },
  };
  if (definition.workspace_id) {
    payload.scopeWorkspaceId = { kind: 'LITERAL', value: definition.workspace_id };
  }
  if (definition.project_object_id) {
    payload.scopeProjectId = { kind: 'LITERAL', value: definition.project_object_id };
  }
  return {
    type: 'EMIT_EVENT',
    eventType: 'bridata.notification.requested',
    aggregateId: { kind: 'EVENT_PATH', path: 'aggregateId' },
    payload,
  };
}

export async function automationActionsV2Routes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/v1/automations-v1/:id/internal-notification-version-v2',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      const body = bodySchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send({ error: 'validation_error' });
      }

      let condition: AutomationConditionV1 | null;
      try {
        condition = toCondition(body.data.condition);
      } catch (error) {
        if (error instanceof AutomationValidationErrorV1) {
          return reply.code(400).send({ error: 'invalid_automation', message: error.message });
        }
        throw error;
      }

      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const definitions = await tx.$queryRaw<DefinitionRow[]>(Prisma.sql`
          SELECT id, workspace_id, project_object_id, name
          FROM automation_definitions_v1
          WHERE tenant_id = ${actor.tenantId}::uuid
            AND id = ${params.data.id}::uuid
          FOR UPDATE
        `);
        const definition = definitions[0];
        if (!definition) return { kind: 'not_found' as const };

        const permission = definition.workspace_id
          ? await authorizePermission(tx, actor, 'workspace.manage_automation', {
              workspaceId: definition.workspace_id,
              projectId: definition.project_object_id,
            })
          : await authorizePermission(tx, actor, 'tenant.manage_automation');
        if (!permission.allowed) return { kind: 'forbidden' as const };

        const targetMembership = await tx.tenantMembership.findUnique({
          where: { tenantId_userId: { tenantId: actor.tenantId, userId: body.data.targetUserId } },
          include: { user: { select: { isActive: true } } },
        });
        if (!targetMembership || targetMembership.status !== 'ACTIVE' || !targetMembership.user.isActive) {
          return { kind: 'invalid_target' as const };
        }

        const action = notificationAction(definition, body.data);
        try {
          validateAutomationVersionV1({
            triggerEventType: body.data.triggerEventType,
            condition,
            actions: [action],
          });
        } catch (error) {
          if (error instanceof AutomationValidationErrorV1) {
            return { kind: 'invalid_automation' as const, message: error.message };
          }
          throw error;
        }

        const nextRows = await tx.$queryRaw<Array<{ next_version: number }>>(Prisma.sql`
          SELECT COALESCE(MAX(version), 0) + 1 AS next_version
          FROM automation_versions_v1
          WHERE tenant_id = ${actor.tenantId}::uuid
            AND definition_id = ${definition.id}::uuid
        `);
        const version = Number(nextRows[0]?.next_version ?? 1);
        const inserted = await tx.$queryRaw<VersionRow[]>(Prisma.sql`
          INSERT INTO automation_versions_v1
            (tenant_id, definition_id, version, trigger_event_type, condition_dsl, actions,
             change_note, created_by_user_id)
          VALUES
            (${actor.tenantId}::uuid, ${definition.id}::uuid, ${version}, ${body.data.triggerEventType},
             ${JSON.stringify(condition)}::jsonb, ${JSON.stringify([action])}::jsonb,
             ${body.data.changeNote ?? 'Internal notification action V2'}, ${actor.userId}::uuid)
          RETURNING id, version, trigger_event_type, condition_dsl, actions, created_at
        `);
        const row = inserted[0]!;

        if (body.data.activate) {
          await tx.$executeRaw(Prisma.sql`
            UPDATE automation_definitions_v1
            SET active_version = ${version}, status = 'ACTIVE',
                updated_by_user_id = ${actor.userId}::uuid, updated_at = CURRENT_TIMESTAMP
            WHERE tenant_id = ${actor.tenantId}::uuid
              AND id = ${definition.id}::uuid
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
                actionType: 'SEND_INTERNAL_NOTIFICATION',
                targetUserId: body.data.targetUserId,
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
              action: 'AUTOMATION_INTERNAL_NOTIFICATION_VERSION_PUBLISHED',
              resource: 'AUTOMATION',
              resourceId: definition.id,
              correlationId: request.id,
              ipAddress: request.ip,
              details: {
                version,
                targetUserId: body.data.targetUserId,
                triggerEventType: body.data.triggerEventType,
                activated: body.data.activate,
              },
            },
          }),
        ]);

        return { kind: 'ok' as const, row, definition };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'automation_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'automation_management_denied' });
      if (result.kind === 'invalid_target') return reply.code(400).send({ error: 'notification_target_invalid' });
      if (result.kind === 'invalid_automation') {
        return reply.code(400).send({ error: 'invalid_automation', message: result.message });
      }

      return reply.code(201).send({
        automationId: result.definition.id,
        versionId: result.row.id,
        version: result.row.version,
        triggerEventType: result.row.trigger_event_type,
        actionType: 'SEND_INTERNAL_NOTIFICATION',
        active: body.data.activate,
        createdAt: result.row.created_at.toISOString(),
      });
    },
  );
}
