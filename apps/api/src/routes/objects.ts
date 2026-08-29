import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  authenticate,
  requireTenantRoles,
  resolveActor,
  type ActorContext,
} from '../auth.js';
import { withTenant } from '../tenant-transaction.js';

const listQuerySchema = z.object({
  workspaceId: z.string().uuid().optional(),
  type: z.string().trim().min(1).max(100).optional(),
  status: z.string().trim().min(1).max(100).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const createObjectSchema = z.object({
  workspaceId: z.string().uuid(),
  objectDefinitionId: z.string().uuid(),
  objectTypeKey: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(500),
  description: z.string().max(20000).optional(),
  status: z.string().trim().min(1).max(100).default('DRAFT'),
  priority: z.string().trim().min(1).max(50).default('MEDIUM'),
  progress: z.number().int().min(0).max(100).default(0),
  assigneeId: z.string().uuid().optional(),
  startDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateObjectSchema = z
  .object({
    version: z.number().int().positive(),
    title: z.string().trim().min(1).max(500).optional(),
    description: z.string().max(20000).nullable().optional(),
    status: z.string().trim().min(1).max(100).optional(),
    priority: z.string().trim().min(1).max(50).optional(),
    progress: z.number().int().min(0).max(100).optional(),
    assigneeId: z.string().uuid().nullable().optional(),
    startDate: z.coerce.date().nullable().optional(),
    dueDate: z.coerce.date().nullable().optional(),
    metadata: z.record(z.unknown()).nullable().optional(),
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'version'), {
    message: 'At least one mutable field is required.',
  });

const idParamsSchema = z.object({ id: z.string().uuid() });

function asJson(value: Record<string, unknown> | null) {
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

function historyComparableValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value ?? null;
}

function historyValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(historyComparableValue(left)) === JSON.stringify(historyComparableValue(right));
}

function historyJson(value: unknown): string {
  return JSON.stringify(historyComparableValue(value)) ?? 'null';
}

function isTenantAdmin(actor: ActorContext): boolean {
  return actor.role === 'OWNER' || actor.role === 'TENANT_ADMIN';
}

async function canAccessWorkspace(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  workspaceId: string,
): Promise<boolean> {
  if (isTenantAdmin(actor)) return true;

  const membership = await tx.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId: actor.userId,
      },
    },
    select: { tenantId: true },
  });

  return membership?.tenantId === actor.tenantId;
}

async function isActiveTenantUser(
  tx: Prisma.TransactionClient,
  tenantId: string,
  userId: string,
): Promise<boolean> {
  const membership = await tx.tenantMembership.findUnique({
    where: { tenantId_userId: { tenantId, userId } },
    include: { user: { select: { isActive: true } } },
  });

  return membership?.status === 'ACTIVE' && membership.user.isActive;
}

export async function objectRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/objects',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const parsed = listQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation_error',
          details: parsed.error.flatten(),
        });
      }

      const actor = request.actor!;
      const query = parsed.data;

      const result = await withTenant(actor.tenantId, async (tx) => {
        let allowedWorkspaceIds: string[] | undefined;

        if (!isTenantAdmin(actor)) {
          const memberships = await tx.workspaceMember.findMany({
            where: { tenantId: actor.tenantId, userId: actor.userId },
            select: { workspaceId: true },
          });
          allowedWorkspaceIds = memberships.map((item) => item.workspaceId);

          if (query.workspaceId && !allowedWorkspaceIds.includes(query.workspaceId)) {
            return { forbidden: true as const, items: [], nextCursor: null };
          }
        }

        const rows = await tx.nexusObject.findMany({
          where: {
            tenantId: actor.tenantId,
            deletedAt: null,
            ...(query.workspaceId
              ? { workspaceId: query.workspaceId }
              : allowedWorkspaceIds
                ? { workspaceId: { in: allowedWorkspaceIds } }
                : {}),
            ...(query.type ? { objectTypeKey: query.type } : {}),
            ...(query.status ? { status: query.status } : {}),
          },
          take: query.limit + 1,
          ...(query.cursor
            ? {
                cursor: { id: query.cursor },
                skip: 1,
              }
            : {}),
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          include: {
            owner: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
            assignee: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
          },
        });

        const hasMore = rows.length > query.limit;
        const items = hasMore ? rows.slice(0, query.limit) : rows;
        return {
          forbidden: false as const,
          items,
          nextCursor: hasMore ? items.at(-1)?.id ?? null : null,
        };
      });

      if (result.forbidden) {
        return reply.code(403).send({ error: 'workspace_access_denied' });
      }

      return { items: result.items, nextCursor: result.nextCursor };
    },
  );

  app.post(
    '/api/v1/objects',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const parsed = createObjectSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation_error',
          details: parsed.error.flatten(),
        });
      }

      const actor = request.actor!;
      const data = parsed.data;

      const result = await withTenant(actor.tenantId, async (tx) => {
        if (!(await canAccessWorkspace(tx, actor, data.workspaceId))) {
          return { kind: 'forbidden' as const };
        }

        const [workspace, definition] = await Promise.all([
          tx.workspace.findFirst({
            where: { id: data.workspaceId, tenantId: actor.tenantId },
            select: { id: true },
          }),
          tx.objectDefinition.findFirst({
            where: { id: data.objectDefinitionId, tenantId: actor.tenantId },
            select: { id: true, key: true },
          }),
        ]);

        if (!workspace || !definition) {
          return { kind: 'not_found' as const };
        }

        if (definition.key !== data.objectTypeKey) {
          return { kind: 'definition_mismatch' as const };
        }

        if (
          data.assigneeId &&
          !(await isActiveTenantUser(tx, actor.tenantId, data.assigneeId))
        ) {
          return { kind: 'invalid_assignee' as const };
        }

        const object = await tx.nexusObject.create({
          data: {
            tenantId: actor.tenantId,
            workspaceId: data.workspaceId,
            objectDefinitionId: data.objectDefinitionId,
            objectTypeKey: data.objectTypeKey,
            title: data.title,
            status: data.status,
            priority: data.priority,
            progress: data.progress,
            ownerId: actor.userId,
            ...(data.description !== undefined ? { description: data.description } : {}),
            ...(data.assigneeId !== undefined ? { assigneeId: data.assigneeId } : {}),
            ...(data.startDate !== undefined ? { startDate: data.startDate } : {}),
            ...(data.dueDate !== undefined ? { dueDate: data.dueDate } : {}),
            ...(data.metadata !== undefined ? { metadata: asJson(data.metadata) } : {}),
          },
        });

        await Promise.all([
          tx.domainEvent.create({
            data: {
              tenantId: actor.tenantId,
              aggregateId: object.id,
              eventType: 'nexus.object.created',
              payload: {
                objectId: object.id,
                objectTypeKey: object.objectTypeKey,
                workspaceId: object.workspaceId,
                actorId: actor.userId,
                version: object.version,
              },
            },
          }),
          tx.auditLog.create({
            data: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              action: 'OBJECT_CREATED',
              resource: 'NEXUS_OBJECT',
              resourceId: object.id,
              correlationId: request.id,
              ipAddress: request.ip,
              details: {
                objectTypeKey: object.objectTypeKey,
                workspaceId: object.workspaceId,
              },
            },
          }),
        ]);

        return { kind: 'created' as const, object };
      });

      if (result.kind === 'forbidden') {
        return reply.code(403).send({ error: 'workspace_access_denied' });
      }
      if (result.kind === 'not_found') {
        return reply.code(404).send({
          error: 'context_not_found',
          message: 'Workspace or object definition was not found in this tenant.',
        });
      }
      if (result.kind === 'definition_mismatch') {
        return reply.code(400).send({
          error: 'object_definition_mismatch',
          message: 'objectTypeKey does not match the selected object definition.',
        });
      }
      if (result.kind === 'invalid_assignee') {
        return reply.code(400).send({
          error: 'invalid_assignee',
          message: 'The assignee is not an active member of this tenant.',
        });
      }

      return reply.code(201).send(result.object);
    },
  );

  app.patch(
    '/api/v1/objects/:id',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = idParamsSchema.safeParse(request.params);
      const body = updateObjectSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send({
          error: 'validation_error',
          details: {
            ...(params.success ? {} : { params: params.error.flatten() }),
            ...(body.success ? {} : { body: body.error.flatten() }),
          },
        });
      }

      const actor = request.actor!;
      const { version, ...updates } = body.data;

      const result = await withTenant(actor.tenantId, async (tx) => {
        const current = await tx.nexusObject.findFirst({
          where: {
            id: params.data.id,
            tenantId: actor.tenantId,
            deletedAt: null,
          },
          select: {
            id: true,
            workspaceId: true,
            title: true,
            description: true,
            status: true,
            priority: true,
            progress: true,
            assigneeId: true,
            startDate: true,
            dueDate: true,
            metadata: true,
          },
        });

        if (!current) return { kind: 'not_found' as const };
        if (!(await canAccessWorkspace(tx, actor, current.workspaceId))) {
          return { kind: 'forbidden' as const };
        }

        if (
          updates.status !== undefined &&
          updates.status !== current.status &&
          ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'].includes(updates.status)
        ) {
          return { kind: 'approval_managed_status' as const };
        }

        if (
          updates.status !== undefined &&
          updates.status !== current.status &&
          current.status === 'PENDING_APPROVAL'
        ) {
          const pendingApproval = await tx.objectApprovalRequestV1.findFirst({
            where: {
              tenantId: actor.tenantId,
              objectId: current.id,
              status: 'PENDING',
            },
            select: { id: true },
          });
          if (pendingApproval) return { kind: 'approval_pending' as const };
        }

        if (
          updates.assigneeId &&
          !(await isActiveTenantUser(tx, actor.tenantId, updates.assigneeId))
        ) {
          return { kind: 'invalid_assignee' as const };
        }

        const updateResult = await tx.nexusObject.updateMany({
          where: {
            id: params.data.id,
            tenantId: actor.tenantId,
            version,
            deletedAt: null,
          },
          data: {
            ...(updates.title !== undefined ? { title: updates.title } : {}),
            ...(updates.description !== undefined ? { description: updates.description } : {}),
            ...(updates.status !== undefined ? { status: updates.status } : {}),
            ...(updates.priority !== undefined ? { priority: updates.priority } : {}),
            ...(updates.progress !== undefined ? { progress: updates.progress } : {}),
            ...(updates.assigneeId !== undefined ? { assigneeId: updates.assigneeId } : {}),
            ...(updates.startDate !== undefined ? { startDate: updates.startDate } : {}),
            ...(updates.dueDate !== undefined ? { dueDate: updates.dueDate } : {}),
            ...(updates.metadata !== undefined ? { metadata: asJson(updates.metadata) } : {}),
            version: { increment: 1 },
          },
        });

        if (updateResult.count !== 1) {
          return { kind: 'version_conflict' as const };
        }

        const object = await tx.nexusObject.findUniqueOrThrow({
          where: { id: params.data.id },
        });

        const historyChanges = [
          ...(updates.title !== undefined ? [{ fieldKey: 'title', oldValue: current.title, newValue: object.title }] : []),
          ...(updates.description !== undefined ? [{ fieldKey: 'description', oldValue: current.description, newValue: object.description }] : []),
          ...(updates.status !== undefined ? [{ fieldKey: 'status', oldValue: current.status, newValue: object.status }] : []),
          ...(updates.priority !== undefined ? [{ fieldKey: 'priority', oldValue: current.priority, newValue: object.priority }] : []),
          ...(updates.progress !== undefined ? [{ fieldKey: 'progress', oldValue: current.progress, newValue: object.progress }] : []),
          ...(updates.assigneeId !== undefined ? [{ fieldKey: 'assigneeId', oldValue: current.assigneeId, newValue: object.assigneeId }] : []),
          ...(updates.startDate !== undefined ? [{ fieldKey: 'startDate', oldValue: current.startDate, newValue: object.startDate }] : []),
          ...(updates.dueDate !== undefined ? [{ fieldKey: 'dueDate', oldValue: current.dueDate, newValue: object.dueDate }] : []),
          ...(updates.metadata !== undefined ? [{ fieldKey: 'metadata', oldValue: current.metadata, newValue: object.metadata }] : []),
        ].filter((entry) => !historyValuesEqual(entry.oldValue, entry.newValue));
        const changedFields = historyChanges.map((entry) => entry.fieldKey);
        const userAgentHeader = request.headers['user-agent'];
        const userAgent = typeof userAgentHeader === 'string' ? userAgentHeader : null;

        await Promise.all([
          ...historyChanges.map((entry) => tx.$executeRaw(Prisma.sql`
            INSERT INTO object_history
              (tenant_id, object_id, user_id, field_key, old_value, new_value, ip_address, user_agent)
            VALUES
              (${actor.tenantId}::uuid, ${object.id}::uuid, ${actor.userId}::uuid, ${entry.fieldKey},
               ${historyJson(entry.oldValue)}::jsonb, ${historyJson(entry.newValue)}::jsonb, ${request.ip}, ${userAgent})
          `)),
          tx.domainEvent.create({
            data: {
              tenantId: actor.tenantId,
              aggregateId: object.id,
              eventType: 'nexus.object.updated',
              payload: {
                objectId: object.id,
                actorId: actor.userId,
                previousVersion: version,
                version: object.version,
                changedFields,
              },
            },
          }),
          tx.auditLog.create({
            data: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              action: 'OBJECT_UPDATED',
              resource: 'NEXUS_OBJECT',
              resourceId: object.id,
              correlationId: request.id,
              ipAddress: request.ip,
              details: {
                version: object.version,
                changedFields,
                historyEntries: historyChanges.length,
              },
            },
          }),
        ]);

        return { kind: 'updated' as const, object };
      });

      if (result.kind === 'not_found') {
        return reply.code(404).send({ error: 'not_found' });
      }
      if (result.kind === 'forbidden') {
        return reply.code(403).send({ error: 'workspace_access_denied' });
      }
      if (result.kind === 'invalid_assignee') {
        return reply.code(400).send({ error: 'invalid_assignee' });
      }
      if (result.kind === 'approval_managed_status') {
        return reply.code(409).send({
          error: 'approval_status_managed_by_workflow',
          message: 'PENDING_APPROVAL, APPROVED and REJECTED are managed by Object Approval Core.',
        });
      }
      if (result.kind === 'approval_pending') {
        return reply.code(409).send({
          error: 'approval_pending',
          message: 'The object status is governed by a pending approval request.',
        });
      }
      if (result.kind === 'version_conflict') {
        return reply.code(409).send({
          error: 'version_conflict',
          message: 'The object changed since you loaded it. Reload before saving again.',
        });
      }

      return result.object;
    },
  );

  app.delete(
    '/api/v1/objects/:id',
    {
      preHandler: [
        authenticate,
        resolveActor,
        requireTenantRoles('OWNER', 'TENANT_ADMIN'),
      ],
    },
    async (request, reply) => {
      const params = idParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'validation_error' });
      }

      const actor = request.actor!;
      const deleted = await withTenant(actor.tenantId, async (tx) => {
        const result = await tx.nexusObject.updateMany({
          where: {
            id: params.data.id,
            tenantId: actor.tenantId,
            deletedAt: null,
          },
          data: {
            deletedAt: new Date(),
            version: { increment: 1 },
          },
        });

        if (result.count !== 1) return false;

        await Promise.all([
          tx.domainEvent.create({
            data: {
              tenantId: actor.tenantId,
              aggregateId: params.data.id,
              eventType: 'nexus.object.deleted',
              payload: {
                objectId: params.data.id,
                actorId: actor.userId,
              },
            },
          }),
          tx.auditLog.create({
            data: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              action: 'OBJECT_SOFT_DELETED',
              resource: 'NEXUS_OBJECT',
              resourceId: params.data.id,
              correlationId: request.id,
              ipAddress: request.ip,
            },
          }),
        ]);

        return true;
      });

      if (!deleted) {
        return reply.code(404).send({ error: 'not_found' });
      }

      return reply.code(204).send();
    },
  );
}
