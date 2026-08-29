import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor, type ActorContext } from '../auth.js';
import { withTenant } from '../tenant-transaction.js';

const uuid = z.string().uuid();
const relationTypeSchema = z.enum([
  'BLOCKS',
  'DEPENDS_ON',
  'DERIVED_FROM',
  'RELATES_TO',
  'MITIGATES',
  'REQUIRES_APPROVAL',
]);
const genericWritableRelationTypeSchema = z.enum([
  'BLOCKS',
  'DERIVED_FROM',
  'RELATES_TO',
  'MITIGATES',
  'REQUIRES_APPROVAL',
]);

const listQuerySchema = z.object({ workspaceId: uuid });
const createRelationSchema = z.object({
  sourceObjectId: uuid,
  targetObjectId: uuid,
  relationType: genericWritableRelationTypeSchema,
  notes: z.string().trim().max(4000).optional(),
});
const idParamsSchema = z.object({ id: uuid });

type ObjectRef = { id: string; workspaceId: string };

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
    where: { workspaceId_userId: { workspaceId, userId: actor.userId } },
    select: { tenantId: true },
  });
  return membership?.tenantId === actor.tenantId;
}

function serializeRelation(row: {
  id: string;
  sourceObjectId: string;
  targetObjectId: string;
  relationType: string;
  notes: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    sourceObjectId: row.sourceObjectId,
    targetObjectId: row.targetObjectId,
    relationType: relationTypeSchema.parse(row.relationType),
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

async function findObjectRef(
  tx: Prisma.TransactionClient,
  tenantId: string,
  id: string,
): Promise<ObjectRef | null> {
  return tx.nexusObject.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: { id: true, workspaceId: true },
  });
}

async function writeObjectRelationAudit(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    userId: string;
    requestId: string;
    ipAddress: string;
    action: 'OBJECT_RELATION_CREATED' | 'OBJECT_RELATION_DELETED';
    relationId: string;
    sourceObjectId: string;
    targetObjectId: string;
    relationType: string;
  },
): Promise<void> {
  await Promise.all([
    tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        action: input.action,
        resource: 'NEXUS_OBJECT',
        resourceId: input.sourceObjectId,
        correlationId: input.requestId,
        ipAddress: input.ipAddress,
        details: {
          relationId: input.relationId,
          direction: 'SOURCE',
          relatedObjectId: input.targetObjectId,
          relationType: input.relationType,
        },
      },
    }),
    tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        action: input.action,
        resource: 'NEXUS_OBJECT',
        resourceId: input.targetObjectId,
        correlationId: input.requestId,
        ipAddress: input.ipAddress,
        details: {
          relationId: input.relationId,
          direction: 'TARGET',
          relatedObjectId: input.sourceObjectId,
          relationType: input.relationType,
        },
      },
    }),
  ]);
}

export async function objectRelationsV1Routes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/object-relations-v1',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const query = listQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ error: 'validation_error', details: query.error.flatten() });
      }

      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        if (!(await canAccessWorkspace(tx, actor, query.data.workspaceId))) {
          return { kind: 'forbidden' as const, items: [] };
        }

        const rows = await tx.objectRelation.findMany({
          where: {
            tenantId: actor.tenantId,
            sourceObject: { workspaceId: query.data.workspaceId, deletedAt: null },
            targetObject: { workspaceId: query.data.workspaceId, deletedAt: null },
            relationType: { in: relationTypeSchema.options },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });

        return { kind: 'ok' as const, items: rows.map(serializeRelation) };
      });

      if (result.kind === 'forbidden') {
        return reply.code(403).send({ error: 'workspace_access_denied' });
      }
      return { items: result.items };
    },
  );

  app.post(
    '/api/v1/object-relations-v1',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const body = createRelationSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'validation_error', details: body.error.flatten() });
      }
      if (body.data.sourceObjectId === body.data.targetObjectId) {
        return reply.code(400).send({ error: 'invalid_relation', message: 'An object cannot relate to itself.' });
      }

      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const [source, target] = await Promise.all([
          findObjectRef(tx, actor.tenantId, body.data.sourceObjectId),
          findObjectRef(tx, actor.tenantId, body.data.targetObjectId),
        ]);
        if (!source || !target) return { kind: 'not_found' as const };
        if (source.workspaceId !== target.workspaceId) return { kind: 'cross_workspace' as const };
        if (!(await canAccessWorkspace(tx, actor, source.workspaceId))) return { kind: 'forbidden' as const };

        const duplicate = await tx.objectRelation.findFirst({
          where: {
            tenantId: actor.tenantId,
            sourceObjectId: source.id,
            targetObjectId: target.id,
            relationType: body.data.relationType,
          },
          select: { id: true },
        });
        if (duplicate) return { kind: 'duplicate' as const };

        const relation = await tx.objectRelation.create({
          data: {
            tenantId: actor.tenantId,
            sourceObjectId: source.id,
            targetObjectId: target.id,
            relationType: body.data.relationType,
            ...(body.data.notes !== undefined ? { notes: body.data.notes } : {}),
          },
        });

        await Promise.all([
          tx.domainEvent.create({
            data: {
              tenantId: actor.tenantId,
              aggregateId: relation.id,
              eventType: 'bridata.object-relation.created',
              idempotencyKey: `object-relation-created:${relation.id}`,
              payload: {
                relationId: relation.id,
                sourceObjectId: source.id,
                targetObjectId: target.id,
                relationType: relation.relationType,
                actorId: actor.userId,
              },
            },
          }),
          writeObjectRelationAudit(tx, {
            tenantId: actor.tenantId,
            userId: actor.userId,
            requestId: request.id,
            ipAddress: request.ip,
            action: 'OBJECT_RELATION_CREATED',
            relationId: relation.id,
            sourceObjectId: source.id,
            targetObjectId: target.id,
            relationType: relation.relationType,
          }),
        ]);

        return { kind: 'created' as const, relation: serializeRelation(relation) };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'object_not_found' });
      if (result.kind === 'cross_workspace') return reply.code(400).send({ error: 'cross_workspace_relation_not_supported' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });
      if (result.kind === 'duplicate') return reply.code(409).send({ error: 'object_relation_exists' });
      return reply.code(201).send(result.relation);
    },
  );

  app.delete(
    '/api/v1/object-relations-v1/:id',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = idParamsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'validation_error' });

      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const relation = await tx.objectRelation.findFirst({
          where: { id: params.data.id, tenantId: actor.tenantId },
          include: {
            sourceObject: { select: { id: true, workspaceId: true, deletedAt: true } },
            targetObject: { select: { id: true, workspaceId: true, deletedAt: true } },
          },
        });
        if (!relation || relation.sourceObject.deletedAt || relation.targetObject.deletedAt) {
          return { kind: 'not_found' as const };
        }
        if (relation.relationType === 'DEPENDS_ON') return { kind: 'managed_dependency' as const };
        if (relation.sourceObject.workspaceId !== relation.targetObject.workspaceId) {
          return { kind: 'cross_workspace' as const };
        }
        if (!(await canAccessWorkspace(tx, actor, relation.sourceObject.workspaceId))) {
          return { kind: 'forbidden' as const };
        }

        await tx.objectRelation.delete({ where: { id: relation.id } });
        await Promise.all([
          tx.domainEvent.create({
            data: {
              tenantId: actor.tenantId,
              aggregateId: relation.id,
              eventType: 'bridata.object-relation.deleted',
              idempotencyKey: `object-relation-deleted:${relation.id}`,
              payload: {
                relationId: relation.id,
                sourceObjectId: relation.sourceObjectId,
                targetObjectId: relation.targetObjectId,
                relationType: relation.relationType,
                actorId: actor.userId,
              },
            },
          }),
          writeObjectRelationAudit(tx, {
            tenantId: actor.tenantId,
            userId: actor.userId,
            requestId: request.id,
            ipAddress: request.ip,
            action: 'OBJECT_RELATION_DELETED',
            relationId: relation.id,
            sourceObjectId: relation.sourceObjectId,
            targetObjectId: relation.targetObjectId,
            relationType: relation.relationType,
          }),
        ]);

        return { kind: 'deleted' as const };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'object_relation_not_found' });
      if (result.kind === 'managed_dependency') {
        return reply.code(409).send({ error: 'managed_dependency_relation', message: 'Use the dependency endpoint to delete DEPENDS_ON relations.' });
      }
      if (result.kind === 'cross_workspace') return reply.code(409).send({ error: 'cross_workspace_relation_not_supported' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });
      return reply.code(204).send();
    },
  );
}
