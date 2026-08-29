import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { authenticate, resolveActor, type ActorContext } from '../auth.js';
import { withTenant } from '../tenant-transaction.js';

const objectParamsSchema = z.object({ id: z.string().uuid() });
const collaborationQuerySchema = z.object({
  commentLimit: z.coerce.number().int().min(1).max(100).default(50),
  auditLimit: z.coerce.number().int().min(1).max(100).default(50),
  historyLimit: z.coerce.number().int().min(1).max(100).default(100),
});
const createCommentSchema = z.object({
  content: z.string().trim().min(1).max(10_000),
});

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

async function accessibleObject(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  objectId: string,
): Promise<{ id: string; workspaceId: string } | 'forbidden' | null> {
  const object = await tx.nexusObject.findFirst({
    where: {
      id: objectId,
      tenantId: actor.tenantId,
      deletedAt: null,
    },
    select: { id: true, workspaceId: true },
  });

  if (!object) return null;
  if (!(await canAccessWorkspace(tx, actor, object.workspaceId))) return 'forbidden';
  return object;
}

type UserSummary = {
  id: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
};

function userSummaryMap(
  memberships: Array<{ user: UserSummary }>,
): Map<string, UserSummary> {
  return new Map(memberships.map((membership) => [membership.user.id, membership.user]));
}

export async function collaborationV1Routes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/objects/:id/collaboration-v1',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = objectParamsSchema.safeParse(request.params);
      const query = collaborationQuerySchema.safeParse(request.query);
      if (!params.success || !query.success) {
        return reply.code(400).send({ error: 'validation_error' });
      }

      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const object = await accessibleObject(tx, actor, params.data.id);
        if (!object) return { kind: 'not_found' as const };
        if (object === 'forbidden') return { kind: 'forbidden' as const };

        const [comments, history, audit] = await Promise.all([
          tx.objectComment.findMany({
            where: { tenantId: actor.tenantId, objectId: object.id },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: query.data.commentLimit,
          }),
          tx.objectHistory.findMany({
            where: { tenantId: actor.tenantId, objectId: object.id },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: query.data.historyLimit,
          }),
          tx.auditLog.findMany({
            where: {
              tenantId: actor.tenantId,
              resource: 'NEXUS_OBJECT',
              resourceId: object.id,
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: query.data.auditLimit,
          }),
        ]);

        const userIds = Array.from(new Set([
          ...comments.map((comment) => comment.userId),
          ...history.flatMap((entry) => entry.userId ? [entry.userId] : []),
          ...audit.flatMap((entry) => entry.userId ? [entry.userId] : []),
        ]));

        const memberships = userIds.length === 0
          ? []
          : await tx.tenantMembership.findMany({
              where: {
                tenantId: actor.tenantId,
                userId: { in: userIds },
              },
              include: {
                user: {
                  select: {
                    id: true,
                    fullName: true,
                    email: true,
                    avatarUrl: true,
                  },
                },
              },
            });
        const users = userSummaryMap(memberships);

        return {
          kind: 'ok' as const,
          objectId: object.id,
          comments: comments.map((comment) => ({
            id: comment.id,
            objectId: comment.objectId,
            userId: comment.userId,
            content: comment.content,
            metadata: comment.metadata,
            createdAt: comment.createdAt.toISOString(),
            updatedAt: comment.updatedAt.toISOString(),
            author: users.get(comment.userId) ?? null,
          })),
          history: history.map((entry) => ({
            id: entry.id,
            objectId: entry.objectId,
            userId: entry.userId,
            fieldKey: entry.fieldKey,
            oldValue: entry.oldValue,
            newValue: entry.newValue,
            createdAt: entry.createdAt.toISOString(),
            actor: entry.userId ? users.get(entry.userId) ?? null : null,
          })),
          audit: audit.map((entry) => ({
            id: entry.id,
            userId: entry.userId,
            action: entry.action,
            resource: entry.resource,
            resourceId: entry.resourceId,
            details: entry.details,
            correlationId: entry.correlationId,
            createdAt: entry.createdAt.toISOString(),
            actor: entry.userId ? users.get(entry.userId) ?? null : null,
          })),
        };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'object_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });
      return result;
    },
  );

  app.post(
    '/api/v1/objects/:id/comments',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = objectParamsSchema.safeParse(request.params);
      const body = createCommentSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send({
          error: 'validation_error',
          ...(body.success ? {} : { details: body.error.flatten() }),
        });
      }

      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const object = await accessibleObject(tx, actor, params.data.id);
        if (!object) return { kind: 'not_found' as const };
        if (object === 'forbidden') return { kind: 'forbidden' as const };

        const [comment, author] = await Promise.all([
          tx.objectComment.create({
            data: {
              tenantId: actor.tenantId,
              objectId: object.id,
              userId: actor.userId,
              content: body.data.content,
            },
          }),
          tx.user.findUniqueOrThrow({
            where: { id: actor.userId },
            select: {
              id: true,
              fullName: true,
              email: true,
              avatarUrl: true,
            },
          }),
        ]);

        await Promise.all([
          tx.domainEvent.create({
            data: {
              tenantId: actor.tenantId,
              aggregateId: object.id,
              eventType: 'nexus.object.comment.created',
              idempotencyKey: `object-comment:${comment.id}`,
              payload: {
                objectId: object.id,
                commentId: comment.id,
                actorId: actor.userId,
              },
            },
          }),
          tx.auditLog.create({
            data: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              action: 'OBJECT_COMMENT_CREATED',
              resource: 'NEXUS_OBJECT',
              resourceId: object.id,
              correlationId: request.id,
              ipAddress: request.ip,
              details: { commentId: comment.id },
            },
          }),
        ]);

        return {
          kind: 'created' as const,
          comment: {
            id: comment.id,
            objectId: comment.objectId,
            userId: comment.userId,
            content: comment.content,
            metadata: comment.metadata,
            createdAt: comment.createdAt.toISOString(),
            updatedAt: comment.updatedAt.toISOString(),
            author,
          },
        };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'object_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });
      return reply.code(201).send(result.comment);
    },
  );
}
