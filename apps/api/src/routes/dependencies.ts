import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  authenticate,
  resolveActor,
  type ActorContext,
} from '../auth.js';
import { withTenant } from '../tenant-transaction.js';

const dependencyTypeSchema = z.enum(['FS', 'SS', 'FF', 'SF']);

const listQuerySchema = z.object({
  workspaceId: z.string().uuid(),
});

const createDependencySchema = z.object({
  predecessorId: z.string().uuid(),
  successorId: z.string().uuid(),
  dependencyType: dependencyTypeSchema.default('FS'),
  lagDays: z.number().int().min(-3650).max(3650).default(0),
  notes: z.string().trim().max(4000).optional(),
});

const updateDependencySchema = z
  .object({
    dependencyType: dependencyTypeSchema.optional(),
    lagDays: z.number().int().min(-3650).max(3650).optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one mutable dependency field is required.',
  });

const idParamsSchema = z.object({ id: z.string().uuid() });

type StoredMetadata = {
  dependencyType?: string;
  lagDays?: number;
};

type DependencyObjectRef = {
  id: string;
  workspaceId: string;
  metadata: Prisma.JsonValue | null;
};

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

function dependencyMetadata(dependencyType: string, lagDays: number): Prisma.InputJsonValue {
  return { dependencyType, lagDays };
}

function metadataOf(value: Prisma.JsonValue | null): StoredMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const metadata = value as Record<string, Prisma.JsonValue>;
  const result: StoredMetadata = {};
  if (typeof metadata.dependencyType === 'string') {
    result.dependencyType = metadata.dependencyType;
  }
  if (typeof metadata.lagDays === 'number') {
    result.lagDays = metadata.lagDays;
  }
  return result;
}

function projectIdFromMetadata(value: Prisma.JsonValue | null): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const metadata = value as Record<string, Prisma.JsonValue>;
  return typeof metadata.projectId === 'string' ? metadata.projectId : null;
}

function serializeDependency(row: {
  id: string;
  sourceObjectId: string;
  targetObjectId: string;
  notes: string | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
}) {
  const metadata = metadataOf(row.metadata);
  const dependencyType = dependencyTypeSchema.safeParse(metadata.dependencyType);
  return {
    id: row.id,
    predecessorId: row.targetObjectId,
    successorId: row.sourceObjectId,
    dependencyType: dependencyType.success ? dependencyType.data : 'FS',
    lagDays: Number.isInteger(metadata.lagDays) ? metadata.lagDays : 0,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}

function wouldCreateCycle(
  existing: Array<{ sourceObjectId: string; targetObjectId: string }>,
  predecessorId: string,
  successorId: string,
): boolean {
  const adjacency = new Map<string, string[]>();

  // Storage convention: sourceObjectId is the successor and targetObjectId is
  // the predecessor for relationType=DEPENDS_ON.
  for (const relation of existing) {
    const next = adjacency.get(relation.targetObjectId) ?? [];
    next.push(relation.sourceObjectId);
    adjacency.set(relation.targetObjectId, next);
  }

  // Adding predecessor -> successor creates a cycle iff successor can already
  // reach predecessor through dependency-direction edges.
  const stack = [successorId];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === predecessorId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    stack.push(...(adjacency.get(current) ?? []));
  }

  return false;
}

async function syncDependencyToV2(
  tx: Prisma.TransactionClient,
  tenantId: string,
  relationId: string,
  predecessor: DependencyObjectRef,
  successor: DependencyObjectRef,
  dependencyType: 'FS' | 'SS' | 'FF' | 'SF',
  lagDays: number,
  notes: string | null,
): Promise<{ synced: boolean; projectId?: string; lagMinutes?: number }> {
  const predecessorProjectId = projectIdFromMetadata(predecessor.metadata);
  const successorProjectId = projectIdFromMetadata(successor.metadata);
  if (!predecessorProjectId || predecessorProjectId !== successorProjectId) {
    return { synced: false };
  }

  const scheduleProfile = await tx.projectScheduleProfile.findUnique({
    where: { projectObjectId: successorProjectId },
    select: { minutesPerDay: true },
  });
  const minutesPerDay = scheduleProfile?.minutesPerDay ?? 480;
  const lagMinutes = lagDays * minutesPerDay;

  await tx.scheduleDependencyV2.upsert({
    where: {
      projectObjectId_predecessorObjectId_successorObjectId: {
        projectObjectId: successorProjectId,
        predecessorObjectId: predecessor.id,
        successorObjectId: successor.id,
      },
    },
    update: {
      dependencyType,
      lagMinutes,
      notes,
      legacyRelationId: relationId,
    },
    create: {
      tenantId,
      projectObjectId: successorProjectId,
      predecessorObjectId: predecessor.id,
      successorObjectId: successor.id,
      dependencyType,
      lagMinutes,
      notes,
      legacyRelationId: relationId,
    },
  });

  return { synced: true, projectId: successorProjectId, lagMinutes };
}

export async function dependencyRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/dependencies',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const parsed = listQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() });
      }

      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        if (!(await canAccessWorkspace(tx, actor, parsed.data.workspaceId))) {
          return { kind: 'forbidden' as const, items: [] };
        }

        // V1 remains the read source during the transition. New writes are
        // dual-written to ScheduleDependencyV2 until the V2 read path is cut over.
        const rows = await tx.objectRelation.findMany({
          where: {
            tenantId: actor.tenantId,
            relationType: 'DEPENDS_ON',
            sourceObject: {
              workspaceId: parsed.data.workspaceId,
              deletedAt: null,
            },
            targetObject: {
              workspaceId: parsed.data.workspaceId,
              deletedAt: null,
            },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });

        return { kind: 'ok' as const, items: rows.map(serializeDependency) };
      });

      if (result.kind === 'forbidden') {
        return reply.code(403).send({ error: 'workspace_access_denied' });
      }
      return { items: result.items };
    },
  );

  app.post(
    '/api/v1/dependencies',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const parsed = createDependencySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() });
      }

      const actor = request.actor!;
      const data = parsed.data;
      if (data.predecessorId === data.successorId) {
        return reply.code(400).send({
          error: 'invalid_dependency',
          message: 'An object cannot depend on itself.',
        });
      }

      const result = await withTenant(actor.tenantId, async (tx) => {
        const [predecessor, successor] = await Promise.all([
          tx.nexusObject.findFirst({
            where: { id: data.predecessorId, tenantId: actor.tenantId, deletedAt: null },
            select: { id: true, workspaceId: true, metadata: true },
          }),
          tx.nexusObject.findFirst({
            where: { id: data.successorId, tenantId: actor.tenantId, deletedAt: null },
            select: { id: true, workspaceId: true, metadata: true },
          }),
        ]);

        if (!predecessor || !successor) return { kind: 'not_found' as const };
        if (predecessor.workspaceId !== successor.workspaceId) {
          return { kind: 'cross_workspace_not_supported' as const };
        }
        if (!(await canAccessWorkspace(tx, actor, predecessor.workspaceId))) {
          return { kind: 'forbidden' as const };
        }

        const duplicate = await tx.objectRelation.findFirst({
          where: {
            tenantId: actor.tenantId,
            sourceObjectId: data.successorId,
            targetObjectId: data.predecessorId,
            relationType: 'DEPENDS_ON',
          },
          select: { id: true },
        });
        if (duplicate) return { kind: 'duplicate' as const };

        const existing = await tx.objectRelation.findMany({
          where: { tenantId: actor.tenantId, relationType: 'DEPENDS_ON' },
          select: { sourceObjectId: true, targetObjectId: true },
        });
        if (wouldCreateCycle(existing, data.predecessorId, data.successorId)) {
          return { kind: 'cycle' as const };
        }

        const relation = await tx.objectRelation.create({
          data: {
            tenantId: actor.tenantId,
            sourceObjectId: data.successorId,
            targetObjectId: data.predecessorId,
            relationType: 'DEPENDS_ON',
            ...(data.notes !== undefined ? { notes: data.notes } : {}),
            metadata: dependencyMetadata(data.dependencyType, data.lagDays),
          },
        });

        const v2 = await syncDependencyToV2(
          tx,
          actor.tenantId,
          relation.id,
          predecessor,
          successor,
          data.dependencyType,
          data.lagDays,
          relation.notes,
        );

        await Promise.all([
          tx.domainEvent.create({
            data: {
              tenantId: actor.tenantId,
              aggregateId: relation.id,
              eventType: 'bridata.dependency.created',
              payload: {
                dependencyId: relation.id,
                predecessorId: data.predecessorId,
                successorId: data.successorId,
                dependencyType: data.dependencyType,
                lagDays: data.lagDays,
                projectEngineV2Synced: v2.synced,
                ...(v2.projectId ? { projectId: v2.projectId } : {}),
                ...(v2.lagMinutes !== undefined ? { lagMinutes: v2.lagMinutes } : {}),
                actorId: actor.userId,
              },
            },
          }),
          tx.auditLog.create({
            data: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              action: 'DEPENDENCY_CREATED',
              resource: 'OBJECT_RELATION',
              resourceId: relation.id,
              correlationId: request.id,
              ipAddress: request.ip,
              details: {
                predecessorId: data.predecessorId,
                successorId: data.successorId,
                dependencyType: data.dependencyType,
                lagDays: data.lagDays,
                projectEngineV2Synced: v2.synced,
              },
            },
          }),
        ]);

        return { kind: 'created' as const, dependency: serializeDependency(relation) };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'object_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });
      if (result.kind === 'cross_workspace_not_supported') {
        return reply.code(400).send({
          error: 'cross_workspace_dependency_not_supported',
          message: 'Dependencies require both objects to belong to the same workspace.',
        });
      }
      if (result.kind === 'duplicate') return reply.code(409).send({ error: 'dependency_exists' });
      if (result.kind === 'cycle') {
        return reply.code(409).send({
          error: 'dependency_cycle',
          message: 'This dependency would create a scheduling cycle.',
        });
      }

      return reply.code(201).send(result.dependency);
    },
  );

  app.patch(
    '/api/v1/dependencies/:id',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = idParamsSchema.safeParse(request.params);
      const body = updateDependencySchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send({ error: 'validation_error' });
      }

      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const current = await tx.objectRelation.findFirst({
          where: { id: params.data.id, tenantId: actor.tenantId, relationType: 'DEPENDS_ON' },
          include: {
            sourceObject: { select: { id: true, workspaceId: true, metadata: true } },
            targetObject: { select: { id: true, workspaceId: true, metadata: true } },
          },
        });
        if (!current) return { kind: 'not_found' as const };
        if (!(await canAccessWorkspace(tx, actor, current.sourceObject.workspaceId))) {
          return { kind: 'forbidden' as const };
        }

        const previousMetadata = metadataOf(current.metadata);
        const dependencyType = body.data.dependencyType ?? previousMetadata.dependencyType ?? 'FS';
        const parsedDependencyType = dependencyTypeSchema.parse(dependencyType);
        const lagDays = body.data.lagDays ?? previousMetadata.lagDays ?? 0;
        const updated = await tx.objectRelation.update({
          where: { id: current.id },
          data: {
            ...(body.data.notes !== undefined ? { notes: body.data.notes } : {}),
            metadata: dependencyMetadata(parsedDependencyType, lagDays),
          },
        });

        const v2 = await syncDependencyToV2(
          tx,
          actor.tenantId,
          current.id,
          current.targetObject,
          current.sourceObject,
          parsedDependencyType,
          lagDays,
          updated.notes,
        );

        await tx.auditLog.create({
          data: {
            tenantId: actor.tenantId,
            userId: actor.userId,
            action: 'DEPENDENCY_UPDATED',
            resource: 'OBJECT_RELATION',
            resourceId: updated.id,
            correlationId: request.id,
            ipAddress: request.ip,
            details: {
              dependencyType: parsedDependencyType,
              lagDays,
              projectEngineV2Synced: v2.synced,
            },
          },
        });

        return { kind: 'updated' as const, dependency: serializeDependency(updated) };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'dependency_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });
      return result.dependency;
    },
  );

  app.delete(
    '/api/v1/dependencies/:id',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = idParamsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'validation_error' });

      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const current = await tx.objectRelation.findFirst({
          where: { id: params.data.id, tenantId: actor.tenantId, relationType: 'DEPENDS_ON' },
          include: {
            sourceObject: { select: { workspaceId: true } },
            targetObject: { select: { workspaceId: true } },
          },
        });
        if (!current) return { kind: 'not_found' as const };
        if (!(await canAccessWorkspace(tx, actor, current.sourceObject.workspaceId))) {
          return { kind: 'forbidden' as const };
        }

        // Delete the typed row first. The V1 relation remains authoritative until
        // the transaction commits, so a failure cannot leave the engines split.
        await tx.scheduleDependencyV2.deleteMany({
          where: { tenantId: actor.tenantId, legacyRelationId: current.id },
        });
        await tx.objectRelation.delete({ where: { id: current.id } });

        await Promise.all([
          tx.domainEvent.create({
            data: {
              tenantId: actor.tenantId,
              aggregateId: current.id,
              eventType: 'bridata.dependency.deleted',
              payload: {
                dependencyId: current.id,
                predecessorId: current.targetObjectId,
                successorId: current.sourceObjectId,
                projectEngineV2Deleted: true,
                actorId: actor.userId,
              },
            },
          }),
          tx.auditLog.create({
            data: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              action: 'DEPENDENCY_DELETED',
              resource: 'OBJECT_RELATION',
              resourceId: current.id,
              correlationId: request.id,
              ipAddress: request.ip,
            },
          }),
        ]);

        return { kind: 'deleted' as const };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'dependency_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });
      return reply.code(204).send();
    },
  );
}
