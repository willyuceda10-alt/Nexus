import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canAccessWorkspace } from '../authorization.js';
import { withTenant } from '../tenant-transaction.js';

const uuid = z.string().uuid();
const workspaceQuerySchema = z.object({ workspaceId: uuid });
const objectParamsSchema = z.object({ objectId: uuid });

type UserSummary = {
  id: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
};

async function resolveUploaders(
  tx: Prisma.TransactionClient,
  tenantId: string,
  userIds: Array<string | null>,
): Promise<Map<string, UserSummary>> {
  const ids = Array.from(new Set(userIds.filter((value): value is string => Boolean(value))));
  if (ids.length === 0) return new Map();

  const memberships = await tx.tenantMembership.findMany({
    where: { tenantId, userId: { in: ids } },
    include: {
      user: {
        select: { id: true, fullName: true, email: true, avatarUrl: true },
      },
    },
  });

  return new Map(memberships.map((membership) => [membership.user.id, membership.user]));
}

function serializeAttachment(
  attachment: {
    id: string;
    objectId: string;
    fileName: string;
    storageKey: string;
    fileSize: bigint;
    mimeType: string;
    checksumSha256: string | null;
    versionNumber: number;
    uploadedByUserId: string | null;
    previousAttachmentId: string | null;
    createdAt: Date;
  },
  uploaders: Map<string, UserSummary>,
) {
  return {
    id: attachment.id,
    objectId: attachment.objectId,
    fileName: attachment.fileName,
    storageKey: attachment.storageKey,
    fileSize: attachment.fileSize.toString(),
    mimeType: attachment.mimeType,
    checksumSha256: attachment.checksumSha256,
    checksumVerified: Boolean(attachment.checksumSha256 && /^[0-9a-fA-F]{64}$/.test(attachment.checksumSha256)),
    versionNumber: attachment.versionNumber,
    uploadedByUserId: attachment.uploadedByUserId,
    previousAttachmentId: attachment.previousAttachmentId,
    createdAt: attachment.createdAt.toISOString(),
    uploadedBy: attachment.uploadedByUserId
      ? uploaders.get(attachment.uploadedByUserId) ?? null
      : null,
  };
}

export async function documentMetadataV1Routes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/document-metadata-v1',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const query = workspaceQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ error: 'validation_error', details: query.error.flatten() });
      }

      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        if (!(await canAccessWorkspace(tx, actor, query.data.workspaceId))) {
          return { kind: 'forbidden' as const };
        }

        const documents = await tx.nexusObject.findMany({
          where: {
            tenantId: actor.tenantId,
            workspaceId: query.data.workspaceId,
            objectTypeKey: 'DOCUMENT',
            deletedAt: null,
          },
          select: {
            id: true,
            workspaceId: true,
            title: true,
            description: true,
            status: true,
            updatedAt: true,
          },
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        });

        const objectIds = documents.map((document) => document.id);
        const attachments = objectIds.length === 0
          ? []
          : await tx.objectAttachment.findMany({
              where: {
                tenantId: actor.tenantId,
                objectId: { in: objectIds },
              },
              orderBy: [
                { objectId: 'asc' },
                { versionNumber: 'desc' },
                { createdAt: 'desc' },
              ],
            });

        const uploaders = await resolveUploaders(
          tx,
          actor.tenantId,
          attachments.map((attachment) => attachment.uploadedByUserId),
        );

        const grouped = new Map<string, typeof attachments>();
        for (const attachment of attachments) {
          const list = grouped.get(attachment.objectId) ?? [];
          list.push(attachment);
          grouped.set(attachment.objectId, list);
        }

        return {
          kind: 'ok' as const,
          workspaceId: query.data.workspaceId,
          items: documents.map((document) => {
            const versions = grouped.get(document.id) ?? [];
            const latest = versions[0] ?? null;
            return {
              id: document.id,
              workspaceId: document.workspaceId,
              title: document.title,
              description: document.description,
              status: document.status,
              updatedAt: document.updatedAt.toISOString(),
              versionCount: versions.length,
              latestVersion: latest ? serializeAttachment(latest, uploaders) : null,
            };
          }),
        };
      });

      if (result.kind === 'forbidden') {
        return reply.code(403).send({ error: 'workspace_access_denied' });
      }
      return result;
    },
  );

  app.get(
    '/api/v1/document-metadata-v1/:objectId/versions',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = objectParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'validation_error', details: params.error.flatten() });
      }

      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const document = await tx.nexusObject.findFirst({
          where: {
            id: params.data.objectId,
            tenantId: actor.tenantId,
            objectTypeKey: 'DOCUMENT',
            deletedAt: null,
          },
          select: { id: true, workspaceId: true, title: true },
        });
        if (!document) return { kind: 'not_found' as const };
        if (!(await canAccessWorkspace(tx, actor, document.workspaceId))) {
          return { kind: 'forbidden' as const };
        }

        const attachments = await tx.objectAttachment.findMany({
          where: { tenantId: actor.tenantId, objectId: document.id },
          orderBy: [{ versionNumber: 'desc' }, { createdAt: 'desc' }],
        });
        const uploaders = await resolveUploaders(
          tx,
          actor.tenantId,
          attachments.map((attachment) => attachment.uploadedByUserId),
        );

        return {
          kind: 'ok' as const,
          objectId: document.id,
          title: document.title,
          items: attachments.map((attachment) => serializeAttachment(attachment, uploaders)),
        };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'document_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });
      return result;
    },
  );
}
