import { createHash, randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate, requireTenantRoles, resolveActor } from '../auth.js';
import { canAccessWorkspace } from '../authorization.js';
import { config } from '../config.js';
import type { DocumentBinaryStoreV1 } from '../document-binary-store-v1.js';
import { withTenant } from '../tenant-transaction.js';

const uuid = z.string().uuid();
const objectParamsSchema = z.object({ objectId: uuid });
const attachmentParamsSchema = z.object({ attachmentId: uuid });

const allowedExtensions = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.csv', '.png', '.jpg', '.jpeg', '.dwg', '.dxf',
]);

function firstHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function safeFileName(input: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(input);
  } catch {
    return null;
  }
  const normalized = basename(decoded).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!normalized || normalized.length > 180) return null;
  const extension = extname(normalized).toLowerCase();
  if (!allowedExtensions.has(extension)) return null;
  return normalized;
}

function safeMimeType(value: string | undefined): string {
  if (!value || value.length > 150 || !/^[\w.+-]+\/[\w.+-]+$/.test(value)) {
    return 'application/octet-stream';
  }
  return value;
}

export async function documentBinaryV1Routes(
  app: FastifyInstance,
  store: DocumentBinaryStoreV1,
): Promise<void> {
  app.post(
    '/api/v1/document-binary-v1/:objectId/versions',
    {
      preHandler: [
        authenticate,
        resolveActor,
        requireTenantRoles('OWNER', 'TENANT_ADMIN', 'MEMBER'),
      ],
    },
    async (request, reply) => {
      const params = objectParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'validation_error', details: params.error.flatten() });
      }

      const rawFileName = firstHeader(request, 'x-bridata-file-name');
      const fileName = rawFileName ? safeFileName(rawFileName) : null;
      if (!fileName) {
        return reply.code(415).send({
          error: 'unsupported_document_type',
          message: 'Allowed document types are PDF, Office, TXT/CSV, PNG/JPEG, DWG and DXF.',
        });
      }

      if (!Buffer.isBuffer(request.body)) {
        return reply.code(415).send({
          error: 'binary_body_required',
          message: 'Document uploads must use application/octet-stream.',
        });
      }
      const content = request.body;
      if (content.byteLength === 0) {
        return reply.code(400).send({ error: 'empty_document', message: 'The uploaded document is empty.' });
      }
      if (content.byteLength > config.DOCUMENT_MAX_FILE_BYTES) {
        return reply.code(413).send({
          error: 'document_too_large',
          message: `Document exceeds the ${config.DOCUMENT_MAX_FILE_BYTES} byte upload limit.`,
        });
      }

      const actor = request.actor!;
      const access = await withTenant(actor.tenantId, async (tx) => {
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
        return { kind: 'ok' as const, document };
      });

      if (access.kind === 'not_found') return reply.code(404).send({ error: 'document_not_found' });
      if (access.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });

      const checksumSha256 = createHash('sha256').update(content).digest('hex');
      const storageKey = `${actor.tenantId}/${access.document.id}/${randomUUID()}`;
      const mimeType = safeMimeType(firstHeader(request, 'x-bridata-file-mime-type'));

      await store.put({
        storageKey,
        fileName,
        content,
        contentType: mimeType,
        checksumSha256,
      });

      try {
        const result = await withTenant(actor.tenantId, async (tx) => {
          const latest = await tx.objectAttachment.findFirst({
            where: { tenantId: actor.tenantId, objectId: access.document.id },
            orderBy: [{ versionNumber: 'desc' }, { createdAt: 'desc' }],
            select: { id: true, versionNumber: true },
          });
          const versionNumber = (latest?.versionNumber ?? 0) + 1;
          const attachment = await tx.objectAttachment.create({
            data: {
              tenantId: actor.tenantId,
              objectId: access.document.id,
              fileName,
              storageKey,
              fileSize: BigInt(content.byteLength),
              mimeType,
              checksumSha256,
              versionNumber,
              uploadedByUserId: actor.userId,
              previousAttachmentId: latest?.id ?? null,
            },
          });

          await Promise.all([
            tx.auditLog.create({
              data: {
                tenantId: actor.tenantId,
                userId: actor.userId,
                action: 'DOCUMENT_VERSION_UPLOADED',
                resource: 'NEXUS_OBJECT',
                resourceId: access.document.id,
                correlationId: request.id,
                ipAddress: request.ip,
                details: {
                  attachmentId: attachment.id,
                  versionNumber,
                  fileName,
                  fileSize: content.byteLength,
                  mimeType,
                  checksumSha256,
                },
              },
            }),
            tx.domainEvent.create({
              data: {
                tenantId: actor.tenantId,
                aggregateId: access.document.id,
                eventType: 'document.version.uploaded',
                payload: {
                  objectId: access.document.id,
                  attachmentId: attachment.id,
                  versionNumber,
                  actorId: actor.userId,
                },
              },
            }),
          ]);

          return attachment;
        });

        return reply.code(201).send({
          id: result.id,
          objectId: result.objectId,
          fileName: result.fileName,
          fileSize: result.fileSize.toString(),
          mimeType: result.mimeType,
          checksumSha256: result.checksumSha256,
          checksumVerified: true,
          versionNumber: result.versionNumber,
          uploadedByUserId: result.uploadedByUserId,
          previousAttachmentId: result.previousAttachmentId,
          createdAt: result.createdAt.toISOString(),
          uploadedBy: {
            id: actor.userId,
            fullName: actor.name,
            email: actor.email,
            avatarUrl: null,
          },
        });
      } catch (error) {
        await store.delete(storageKey).catch(() => undefined);
        if ((error as { code?: string }).code === 'P2002') {
          return reply.code(409).send({
            error: 'document_version_conflict',
            message: 'Another document version was created concurrently. Retry the upload.',
          });
        }
        throw error;
      }
    },
  );

  app.get(
    '/api/v1/document-binary-v1/:attachmentId/download-link',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = attachmentParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'validation_error', details: params.error.flatten() });
      }

      const actor = request.actor!;
      const access = await withTenant(actor.tenantId, async (tx) => {
        const attachment = await tx.objectAttachment.findFirst({
          where: { id: params.data.attachmentId, tenantId: actor.tenantId },
        });
        if (!attachment) return { kind: 'not_found' as const };

        const document = await tx.nexusObject.findFirst({
          where: {
            id: attachment.objectId,
            tenantId: actor.tenantId,
            objectTypeKey: 'DOCUMENT',
            deletedAt: null,
          },
          select: { id: true, workspaceId: true },
        });
        if (!document) return { kind: 'not_found' as const };
        if (!(await canAccessWorkspace(tx, actor, document.workspaceId))) {
          return { kind: 'forbidden' as const };
        }
        return { kind: 'ok' as const, attachment, document };
      });

      if (access.kind === 'not_found') return reply.code(404).send({ error: 'document_binary_not_found' });
      if (access.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });

      const downloadAccess = await store.createReadUrl(access.attachment.storageKey);
      if (!downloadAccess) {
        return reply.code(404).send({
          error: 'document_binary_missing',
          message: 'Document metadata exists, but the binary object was not found in storage.',
        });
      }

      await withTenant(actor.tenantId, (tx) =>
        tx.auditLog.create({
          data: {
            tenantId: actor.tenantId,
            userId: actor.userId,
            action: 'DOCUMENT_VERSION_DOWNLOAD_LINK_ISSUED',
            resource: 'NEXUS_OBJECT',
            resourceId: access.document.id,
            correlationId: request.id,
            ipAddress: request.ip,
            details: {
              attachmentId: access.attachment.id,
              versionNumber: access.attachment.versionNumber,
              expiresAt: downloadAccess.expiresAt.toISOString(),
            },
          },
        }),
      );

      return {
        attachmentId: access.attachment.id,
        fileName: access.attachment.fileName,
        mimeType: access.attachment.mimeType,
        checksumSha256: access.attachment.checksumSha256,
        url: downloadAccess.url,
        expiresAt: downloadAccess.expiresAt.toISOString(),
      };
    },
  );
}
