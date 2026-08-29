import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor, type ActorContext } from '../auth.js';
import { canAccessWorkspace, isTenantAdministrator } from '../authorization.js';
import { withTenant } from '../tenant-transaction.js';

const uuid = z.string().uuid();
const approvalStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']);
const listQuerySchema = z.object({
  objectId: uuid,
  status: approvalStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const eligibleApproverQuerySchema = z.object({ objectId: uuid });

const createApprovalSchema = z.object({
  objectId: uuid,
  approverUserId: uuid,
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().max(10_000).nullable().optional(),
});
const idParamsSchema = z.object({ id: uuid });
const decisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  comment: z.string().max(4000).nullable().optional(),
});
const cancelSchema = z.object({
  comment: z.string().max(4000).nullable().optional(),
});

type ApprovalRow = {
  id: string;
  tenantId: string;
  objectId: string;
  requestedByUserId: string;
  approverUserId: string;
  title: string;
  description: string | null;
  previousObjectStatus: string;
  status: string;
  decisionByUserId: string | null;
  decisionComment: string | null;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type UserSummary = {
  id: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
};

type EligibleApproverRow = {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  tenant_role: string;
  workspace_role: string | null;
};

function userAgentOf(request: { headers: Record<string, unknown> }): string | null {
  const value = request.headers['user-agent'];
  return typeof value === 'string' ? value : null;
}

async function activeTenantUser(
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

async function accessibleObject(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  objectId: string,
): Promise<{
  id: string;
  workspaceId: string;
  title: string;
  status: string;
  version: number;
} | 'forbidden' | null> {
  const object = await tx.nexusObject.findFirst({
    where: { id: objectId, tenantId: actor.tenantId, deletedAt: null },
    select: { id: true, workspaceId: true, title: true, status: true, version: true },
  });
  if (!object) return null;
  if (!(await canAccessWorkspace(tx, actor, object.workspaceId))) return 'forbidden';
  return object;
}

async function resolveUsers(
  tx: Prisma.TransactionClient,
  tenantId: string,
  ids: string[],
): Promise<Map<string, UserSummary>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return new Map();
  const memberships = await tx.tenantMembership.findMany({
    where: { tenantId, userId: { in: unique } },
    include: {
      user: {
        select: { id: true, fullName: true, email: true, avatarUrl: true },
      },
    },
  });
  return new Map(memberships.map((item) => [item.user.id, item.user]));
}

function serializeApproval(row: ApprovalRow, users: Map<string, UserSummary>) {
  return {
    id: row.id,
    objectId: row.objectId,
    requestedByUserId: row.requestedByUserId,
    approverUserId: row.approverUserId,
    title: row.title,
    description: row.description,
    previousObjectStatus: row.previousObjectStatus,
    status: row.status,
    decisionByUserId: row.decisionByUserId,
    decisionComment: row.decisionComment,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    requester: users.get(row.requestedByUserId) ?? null,
    approver: users.get(row.approverUserId) ?? null,
    decisionBy: row.decisionByUserId ? users.get(row.decisionByUserId) ?? null : null,
  };
}

async function approvalUsers(
  tx: Prisma.TransactionClient,
  tenantId: string,
  rows: ApprovalRow[],
) {
  return resolveUsers(
    tx,
    tenantId,
    rows.flatMap((row) => [
      row.requestedByUserId,
      row.approverUserId,
      ...(row.decisionByUserId ? [row.decisionByUserId] : []),
    ]),
  );
}

export async function objectApprovalsV1Routes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/object-approvals-v1/eligible-approvers',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const query = eligibleApproverQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ error: 'validation_error', details: query.error.flatten() });
      }

      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const object = await accessibleObject(tx, actor, query.data.objectId);
        if (!object) return { kind: 'not_found' as const };
        if (object === 'forbidden') return { kind: 'forbidden' as const };

        const rows = await tx.$queryRaw<EligibleApproverRow[]>(Prisma.sql`
          SELECT
            u.id,
            u.full_name,
            u.email,
            u.avatar_url,
            tm.role::text AS tenant_role,
            wm.role::text AS workspace_role
          FROM tenant_memberships tm
          JOIN users u
            ON u.id = tm.user_id
          LEFT JOIN workspace_members wm
            ON wm.tenant_id = tm.tenant_id
           AND wm.user_id = tm.user_id
           AND wm.workspace_id = ${object.workspaceId}::uuid
          WHERE tm.tenant_id = ${actor.tenantId}::uuid
            AND tm.status::text = 'ACTIVE'
            AND u.is_active = TRUE
            AND (
              tm.role::text IN ('OWNER', 'TENANT_ADMIN')
              OR wm.id IS NOT NULL
            )
          ORDER BY
            CASE tm.role::text
              WHEN 'OWNER' THEN 0
              WHEN 'TENANT_ADMIN' THEN 1
              ELSE 2
            END,
            u.full_name,
            u.email
        `);

        return {
          kind: 'ok' as const,
          objectId: object.id,
          items: rows.map((row) => ({
            id: row.id,
            fullName: row.full_name,
            email: row.email,
            avatarUrl: row.avatar_url,
            tenantRole: row.tenant_role,
            workspaceRole: row.workspace_role,
          })),
        };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'object_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });
      return { objectId: result.objectId, items: result.items };
    },
  );

  app.get(
    '/api/v1/object-approvals-v1',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const query = listQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ error: 'validation_error', details: query.error.flatten() });
      }
      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const object = await accessibleObject(tx, actor, query.data.objectId);
        if (!object) return { kind: 'not_found' as const };
        if (object === 'forbidden') return { kind: 'forbidden' as const };

        const rows = await tx.objectApprovalRequestV1.findMany({
          where: {
            tenantId: actor.tenantId,
            objectId: object.id,
            ...(query.data.status ? { status: query.data.status } : {}),
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: query.data.limit,
        });
        const users = await approvalUsers(tx, actor.tenantId, rows);
        return {
          kind: 'ok' as const,
          objectId: object.id,
          items: rows.map((row) => serializeApproval(row, users)),
        };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'object_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });
      return { objectId: result.objectId, items: result.items };
    },
  );

  app.post(
    '/api/v1/object-approvals-v1',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const body = createApprovalSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'validation_error', details: body.error.flatten() });
      }
      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const object = await accessibleObject(tx, actor, body.data.objectId);
        if (!object) return { kind: 'not_found' as const };
        if (object === 'forbidden') return { kind: 'forbidden' as const };
        if (body.data.approverUserId === actor.userId && !isTenantAdministrator(actor)) {
          return { kind: 'self_approval_denied' as const };
        }
        if (!(await activeTenantUser(tx, actor.tenantId, body.data.approverUserId))) {
          return { kind: 'invalid_approver' as const };
        }

        const existing = await tx.objectApprovalRequestV1.findFirst({
          where: { tenantId: actor.tenantId, objectId: object.id, status: 'PENDING' },
          select: { id: true },
        });
        if (existing || object.status === 'PENDING_APPROVAL') {
          return { kind: 'already_pending' as const };
        }

        const objectUpdate = await tx.nexusObject.updateMany({
          where: {
            id: object.id,
            tenantId: actor.tenantId,
            deletedAt: null,
            version: object.version,
            status: object.status,
          },
          data: { status: 'PENDING_APPROVAL', version: { increment: 1 } },
        });
        if (objectUpdate.count !== 1) return { kind: 'version_conflict' as const };

        const approval = await tx.objectApprovalRequestV1.create({
          data: {
            tenantId: actor.tenantId,
            objectId: object.id,
            requestedByUserId: actor.userId,
            approverUserId: body.data.approverUserId,
            title: body.data.title ?? `Aprobación: ${object.title}`,
            ...(body.data.description !== undefined ? { description: body.data.description } : {}),
            previousObjectStatus: object.status,
          },
        });

        const userAgent = userAgentOf(request as unknown as { headers: Record<string, unknown> });
        await Promise.all([
          tx.objectHistory.create({
            data: {
              tenantId: actor.tenantId,
              objectId: object.id,
              userId: actor.userId,
              fieldKey: 'status',
              oldValue: object.status,
              newValue: 'PENDING_APPROVAL',
              ipAddress: request.ip,
              userAgent,
            },
          }),
          tx.domainEvent.create({
            data: {
              tenantId: actor.tenantId,
              aggregateId: object.id,
              eventType: 'nexus.object.approval.requested',
              idempotencyKey: `object-approval-requested:${approval.id}`,
              payload: {
                objectId: object.id,
                approvalId: approval.id,
                approverUserId: approval.approverUserId,
                requestedByUserId: approval.requestedByUserId,
              },
            },
          }),
          tx.auditLog.create({
            data: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              action: 'OBJECT_APPROVAL_REQUESTED',
              resource: 'NEXUS_OBJECT',
              resourceId: object.id,
              correlationId: request.id,
              ipAddress: request.ip,
              details: {
                approvalId: approval.id,
                approverUserId: approval.approverUserId,
                previousStatus: object.status,
                status: 'PENDING_APPROVAL',
              },
            },
          }),
        ]);

        const users = await approvalUsers(tx, actor.tenantId, [approval]);
        return {
          kind: 'created' as const,
          approval: serializeApproval(approval, users),
          objectStatus: 'PENDING_APPROVAL' as const,
          objectVersion: object.version + 1,
        };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'object_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });
      if (result.kind === 'self_approval_denied') return reply.code(400).send({ error: 'self_approval_not_allowed' });
      if (result.kind === 'invalid_approver') return reply.code(400).send({ error: 'invalid_approver' });
      if (result.kind === 'already_pending') return reply.code(409).send({ error: 'approval_already_pending' });
      if (result.kind === 'version_conflict') return reply.code(409).send({ error: 'version_conflict' });
      return reply.code(201).send({
        approval: result.approval,
        objectStatus: result.objectStatus,
        objectVersion: result.objectVersion,
      });
    },
  );

  app.post(
    '/api/v1/object-approvals-v1/:id/decision',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = idParamsSchema.safeParse(request.params);
      const body = decisionSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send({ error: 'validation_error' });
      }
      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const approval = await tx.objectApprovalRequestV1.findFirst({
          where: { id: params.data.id, tenantId: actor.tenantId },
        });
        if (!approval) return { kind: 'not_found' as const };

        const object = await accessibleObject(tx, actor, approval.objectId);
        if (!object) return { kind: 'object_not_found' as const };
        if (object === 'forbidden') return { kind: 'forbidden' as const };
        if (approval.approverUserId !== actor.userId && !isTenantAdministrator(actor)) {
          return { kind: 'decision_denied' as const };
        }
        if (approval.status !== 'PENDING') return { kind: 'already_decided' as const };
        if (object.status !== 'PENDING_APPROVAL') return { kind: 'object_state_conflict' as const };

        const nextStatus = body.data.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED';
        const objectUpdate = await tx.nexusObject.updateMany({
          where: {
            id: object.id,
            tenantId: actor.tenantId,
            deletedAt: null,
            version: object.version,
            status: 'PENDING_APPROVAL',
          },
          data: { status: nextStatus, version: { increment: 1 } },
        });
        if (objectUpdate.count !== 1) return { kind: 'version_conflict' as const };

        const decidedAt = new Date();
        const approvalUpdate = await tx.objectApprovalRequestV1.updateMany({
          where: { id: approval.id, tenantId: actor.tenantId, status: 'PENDING' },
          data: {
            status: body.data.decision,
            decisionByUserId: actor.userId,
            decisionComment: body.data.comment ?? null,
            decidedAt,
          },
        });
        if (approvalUpdate.count !== 1) {
          throw new Error('Approval changed while decision transaction was in progress.');
        }

        const updated = await tx.objectApprovalRequestV1.findUniqueOrThrow({ where: { id: approval.id } });
        const userAgent = userAgentOf(request as unknown as { headers: Record<string, unknown> });
        await Promise.all([
          tx.objectHistory.create({
            data: {
              tenantId: actor.tenantId,
              objectId: object.id,
              userId: actor.userId,
              fieldKey: 'status',
              oldValue: 'PENDING_APPROVAL',
              newValue: nextStatus,
              ipAddress: request.ip,
              userAgent,
            },
          }),
          tx.domainEvent.create({
            data: {
              tenantId: actor.tenantId,
              aggregateId: object.id,
              eventType: body.data.decision === 'APPROVED'
                ? 'nexus.object.approval.approved'
                : 'nexus.object.approval.rejected',
              idempotencyKey: `object-approval-decision:${approval.id}`,
              payload: {
                objectId: object.id,
                approvalId: approval.id,
                decision: body.data.decision,
                decisionByUserId: actor.userId,
              },
            },
          }),
          tx.auditLog.create({
            data: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              action: 'OBJECT_APPROVAL_DECIDED',
              resource: 'NEXUS_OBJECT',
              resourceId: object.id,
              correlationId: request.id,
              ipAddress: request.ip,
              details: {
                approvalId: approval.id,
                decision: body.data.decision,
                approverUserId: approval.approverUserId,
                decisionByUserId: actor.userId,
                status: nextStatus,
              },
            },
          }),
        ]);

        const users = await approvalUsers(tx, actor.tenantId, [updated]);
        return {
          kind: 'decided' as const,
          approval: serializeApproval(updated, users),
          objectStatus: nextStatus,
          objectVersion: object.version + 1,
        };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'approval_not_found' });
      if (result.kind === 'object_not_found') return reply.code(404).send({ error: 'object_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });
      if (result.kind === 'decision_denied') return reply.code(403).send({ error: 'approval_decision_denied' });
      if (result.kind === 'already_decided') return reply.code(409).send({ error: 'approval_already_decided' });
      if (result.kind === 'object_state_conflict') return reply.code(409).send({ error: 'approval_object_state_conflict' });
      if (result.kind === 'version_conflict') return reply.code(409).send({ error: 'version_conflict' });
      return result;
    },
  );

  app.post(
    '/api/v1/object-approvals-v1/:id/cancel',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = idParamsSchema.safeParse(request.params);
      const body = cancelSchema.safeParse(request.body);
      if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const approval = await tx.objectApprovalRequestV1.findFirst({
          where: { id: params.data.id, tenantId: actor.tenantId },
        });
        if (!approval) return { kind: 'not_found' as const };

        const object = await accessibleObject(tx, actor, approval.objectId);
        if (!object) return { kind: 'object_not_found' as const };
        if (object === 'forbidden') return { kind: 'forbidden' as const };
        if (approval.requestedByUserId !== actor.userId && !isTenantAdministrator(actor)) {
          return { kind: 'cancel_denied' as const };
        }
        if (approval.status !== 'PENDING') return { kind: 'already_decided' as const };
        if (object.status !== 'PENDING_APPROVAL') return { kind: 'object_state_conflict' as const };

        const objectUpdate = await tx.nexusObject.updateMany({
          where: {
            id: object.id,
            tenantId: actor.tenantId,
            deletedAt: null,
            version: object.version,
            status: 'PENDING_APPROVAL',
          },
          data: { status: approval.previousObjectStatus, version: { increment: 1 } },
        });
        if (objectUpdate.count !== 1) return { kind: 'version_conflict' as const };

        const decidedAt = new Date();
        const approvalUpdate = await tx.objectApprovalRequestV1.updateMany({
          where: { id: approval.id, tenantId: actor.tenantId, status: 'PENDING' },
          data: {
            status: 'CANCELLED',
            decisionByUserId: actor.userId,
            decisionComment: body.data.comment ?? null,
            decidedAt,
          },
        });
        if (approvalUpdate.count !== 1) {
          throw new Error('Approval changed while cancellation transaction was in progress.');
        }

        const updated = await tx.objectApprovalRequestV1.findUniqueOrThrow({ where: { id: approval.id } });
        const userAgent = userAgentOf(request as unknown as { headers: Record<string, unknown> });
        await Promise.all([
          tx.objectHistory.create({
            data: {
              tenantId: actor.tenantId,
              objectId: object.id,
              userId: actor.userId,
              fieldKey: 'status',
              oldValue: 'PENDING_APPROVAL',
              newValue: approval.previousObjectStatus,
              ipAddress: request.ip,
              userAgent,
            },
          }),
          tx.domainEvent.create({
            data: {
              tenantId: actor.tenantId,
              aggregateId: object.id,
              eventType: 'nexus.object.approval.cancelled',
              idempotencyKey: `object-approval-cancelled:${approval.id}`,
              payload: {
                objectId: object.id,
                approvalId: approval.id,
                cancelledByUserId: actor.userId,
                restoredStatus: approval.previousObjectStatus,
              },
            },
          }),
          tx.auditLog.create({
            data: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              action: 'OBJECT_APPROVAL_CANCELLED',
              resource: 'NEXUS_OBJECT',
              resourceId: object.id,
              correlationId: request.id,
              ipAddress: request.ip,
              details: {
                approvalId: approval.id,
                cancelledByUserId: actor.userId,
                restoredStatus: approval.previousObjectStatus,
              },
            },
          }),
        ]);

        const users = await approvalUsers(tx, actor.tenantId, [updated]);
        return {
          kind: 'cancelled' as const,
          approval: serializeApproval(updated, users),
          objectStatus: approval.previousObjectStatus,
          objectVersion: object.version + 1,
        };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'approval_not_found' });
      if (result.kind === 'object_not_found') return reply.code(404).send({ error: 'object_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });
      if (result.kind === 'cancel_denied') return reply.code(403).send({ error: 'approval_cancel_denied' });
      if (result.kind === 'already_decided') return reply.code(409).send({ error: 'approval_already_decided' });
      if (result.kind === 'object_state_conflict') return reply.code(409).send({ error: 'approval_object_state_conflict' });
      if (result.kind === 'version_conflict') return reply.code(409).send({ error: 'version_conflict' });
      return result;
    },
  );
}
