import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  authenticate,
  resolveActor,
  type ActorContext,
} from '../auth.js';
import { withTenant } from '../tenant-transaction.js';

const genericRelationTypeSchema = z.enum([
  'BLOCKS',
  'DERIVED_FROM',
  'RELATES_TO',
  'MITIGATES',
  'REQUIRES_APPROVAL',
]);

const listQuerySchema = z.object({
  workspaceId: z.string().uuid(),
});

const createRelationSchema = z.object({
  sourceObjectId: z.string().uuid(),
  targetObjectId: z.string().uuid(),
  relationType: genericRelationTypeSchema,
  notes: z.string().trim().max(4000).optional(),
});

const idParamsSchema = z.object({ id: z.string().uuid() });

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

function serializeRelation(row: {
  id: string;
  sourceObjectId: string;
  targetObjectId: string;
  relationType: string;
  notes: string | null;
  createdAt: Date;
}) {
  const relationType = genericRelationTypeSchema.safeParse(row.relationType);
  if (!relationType.success) {
    throw new Error(`Unsupported generic relation type: ${row.relationType}`);
  }
  return {
    id: row.id,
    sourceObjectId: row.sourceObjectId,
    targetObjectId: row.targetObjectId,
    relationType: relationType.data,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}

export async function relationRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/relations',
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

        const rows = await tx.objectRelation.findMany({
          where: {
            tenantId: actor.tenantId,
            relationType: { in: genericRelationTypeSchema.options },
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

        return { kind: 'ok' as const, items: rows.map(serializeRelation) };
      });

      if (result.kind === 'forbidden') {
        return reply.code(403).send({ error: 'workspace_access_denied' });
      }
      return { items: result.items };
    },
  );

  app.post(
    '/api/v1/relations',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const parsed = createRelationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() });
      }

      const actor = request.actor!;
      const data = parsed.data;
      if (data.sourceObjectId === data.targetObjectId) {
        return reply.code(400).send({
          error: 'invalid_relation',
          message: 'An object cannot be related to itself.',
        });
      }

      const result = await withTenant(actor.tenantId, async (tx) => {
        const [source, target] = await Promise.all([
          tx.nexusObject.findFirst({
            where: { id: data.sourceObjectId, tenantId: actor.tenantId, deletedAt: null },
            select: { id: true, workspaceId: true },
          }),
          tx.nexusObject.findFirst({
            where: { id: data.targetObjectId, tenantId: actor.tenantId, deletedAt: null },
            select: { id: true, workspaceId: true },
          }),
        ]);

        if (!source || !target) return { kind: 'not_found' as const };
        if (source.workspaceId !== target.workspaceId) {
          return { kind: 'cross_workspace_not_supported' as const };
        }
        if (!(await canAccessWorkspace(tx, actor, source.workspaceId))) {
          return { kind: 'forbidden' as const };
        }

        const duplicate = await tx.objectRelation.findFirst({
          where: {
            tenantId: actor.tenantId,
            sourceObjectId: data.sourceObjectId,
            targetObjectId: data.targetObjectId,
            relationType: data.relationType,
          },
          select: { id: true },
        });
        if (duplicate) return { kind: 'duplicate' as const };

        const relation = await tx.objectRelation.create({
          data: {
            tenantId: actor.tenantId,
            sourceObjectId: data.sourceObjectId,
            targetObjectId: data.targetObjectId,
            relationType: data.relationType,
            ...(data.notes !== undefined ? { notes: data.notes } : {}),
          },
        });

        await Promise.all([
          tx.domainEvent.create({
            data: {
              tenantId: actor.tenantId,
              aggregateId: relation.id,
              eventType: 'bridata.object_relation.created',
              payload: {
                relationId: relation.id,
                sourceObjectId: data.sourceObjectId,
                targetObjectId: data.targetObjectId,
                relationType: data.relationType,
                actorId: actor.userId,
              },
            },
          }),
          tx.auditLog.create({
            data: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              action: 'OBJECT_RELATION_CREATED',
              resource: 'OBJECT_RELATION',
              resourceId: relation.id,
              correlationId: request.id,
              ipAddress: request.ip,
              details: {
                sourceObjectId: data.sourceObjectId,
                targetObjectId: data.targetObjectId,
                relationType: data.relationType,
              },
            },
          }),
        ]);

        return { kind: 'created' as const, relation: serializeRelation(relation) };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'object_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });
      if (result.kind === 'cross_workspace_not_supported') {
        return reply.code(400).send({
          error: 'cross_workspace_relation_not_supported',
          message: 'Generic Object Engine relations require both objects to belong to the same workspace.',
        });
      }
      if (result.kind === 'duplicate') return reply.code(409).send({ error: 'relation_exists' });

      return reply.code(201).send(result.relation);
    },
  );

  app.delete(
    '/api/v1/relations/:id',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = idParamsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'validation_error' });

      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const current = await tx.objectRelation.findFirst({
          where: {
            id: params.data.id,
            tenantId: actor.tenantId,
            relationType: { in: genericRelationTypeSchema.options },
          },
          include: {
            sourceObject: { select: { workspaceId: true } },
            targetObject: { select: { workspaceId: true } },
          },
        });
        if (!current) return { kind: 'not_found' as const };
        if (!(await canAccessWorkspace(tx, actor, current.sourceObject.workspaceId))) {
          return { kind: 'forbidden' as const };
        }

        await tx.objectRelation.delete({ where: { id: current.id } });
        await Promise.all([
          tx.domainEvent.create({
            data: {
              tenantId: actor.tenantId,
              aggregateId: current.id,
              eventType: 'bridata.object_relation.deleted',
              payload: {
                relationId: current.id,
                sourceObjectId: current.sourceObjectId,
                targetObjectId: current.targetObjectId,
                relationType: current.relationType,
                actorId: actor.userId,
              },
            },
          }),
          tx.auditLog.create({
            data: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              action: 'OBJECT_RELATION_DELETED',
              resource: 'OBJECT_RELATION',
              resourceId: current.id,
              correlationId: request.id,
              ipAddress: request.ip,
            },
          }),
        ]);

        return { kind: 'deleted' as const };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'relation_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });
      return reply.code(204).send();
    },
  );
}
