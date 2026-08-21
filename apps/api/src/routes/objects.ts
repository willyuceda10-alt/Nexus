import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  authenticate,
  requireTenantRoles,
  resolveActor,
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

function asJson(value: Record<string, unknown> | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
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
        const rows = await tx.nexusObject.findMany({
          where: {
            tenantId: actor.tenantId,
            deletedAt: null,
            ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
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
          items,
          nextCursor: hasMore ? items.at(-1)?.id ?? null : null,
        };
      });

      return result;
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

      const created = await withTenant(actor.tenantId, async (tx) => {
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
          return null;
        }

        if (definition.key !== data.objectTypeKey) {
          throw new Error('Object type key does not match its definition.');
        }

        const object = await tx.nexusObject.create({
          data: {
            tenantId: actor.tenantId,
            workspaceId: data.workspaceId,
            objectDefinitionId: data.objectDefinitionId,
            objectTypeKey: data.objectTypeKey,
            title: data.title,
            description: data.description,
            status: data.status,
            priority: data.priority,
            progress: data.progress,
            ownerId: actor.userId,
            assigneeId: data.assigneeId,
            startDate: data.startDate,
            dueDate: data.dueDate,
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
              details: {
                objectTypeKey: object.objectTypeKey,
                workspaceId: object.workspaceId,
              },
            },
          }),
        ]);

        return object;
      });

      if (!created) {
        return reply.code(404).send({
          error: 'context_not_found',
          message: 'Workspace or object definition was not found in this tenant.',
        });
      }

      return reply.code(201).send(created);
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
            params: params.success ? undefined : params.error.flatten(),
            body: body.success ? undefined : body.error.flatten(),
          },
        });
      }

      const actor = request.actor!;
      const { version, ...updates } = body.data;

      const updated = await withTenant(actor.tenantId, async (tx) => {
        const result = await tx.nexusObject.updateMany({
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

        if (result.count !== 1) return null;

        const object = await tx.nexusObject.findUniqueOrThrow({
          where: { id: params.data.id },
        });

        await Promise.all([
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
                changedFields: Object.keys(updates),
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
              details: {
                version: object.version,
                changedFields: Object.keys(updates),
              },
            },
          }),
        ]);

        return object;
      });

      if (!updated) {
        return reply.code(409).send({
          error: 'version_conflict',
          message: 'The object changed since you loaded it, or it no longer exists.',
        });
      }

      return updated;
    },
  );

  app.delete(
    '/api/v1/objects/:id',
    {
      preHandler: [
        authenticate,
        resolveActor,
        requireTenantRoles('SUPER_ADMIN', 'TENANT_ADMIN'),
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
