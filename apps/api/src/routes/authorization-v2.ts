import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import {
  authorizePermission,
  authorizePermissions,
  canManageWorkspacePermissions,
  isTenantAdministrator,
} from '../authorization.js';
import {
  PERMISSIONS_V2,
  canTransitionWorkspaceRoleV2,
  isPermissionKeyV2,
  type AuthorizationEffectV2,
  type AuthorizationScopeTypeV2,
  type AuthorizationSubjectTypeV2,
  type WorkspaceRoleKeyV2,
} from '../domain/permission-engine-v2.js';
import { withTenant } from '../tenant-transaction.js';

const uuidSchema = z.string().uuid();
const effectiveQuerySchema = z.object({
  workspaceId: uuidSchema.optional(),
  projectId: uuidSchema.optional(),
});
const policyListQuerySchema = z.object({
  workspaceId: uuidSchema.optional(),
  projectId: uuidSchema.optional(),
});
const policyBodySchema = z.object({
  scopeType: z.enum(['TENANT', 'WORKSPACE', 'PROJECT']),
  scopeId: uuidSchema,
  subjectType: z.enum(['USER', 'TENANT_ROLE', 'WORKSPACE_ROLE']),
  subjectKey: z.string().trim().min(1).max(100),
  permissionKey: z.string().trim().min(1).max(150),
  effect: z.enum(['ALLOW', 'DENY']),
  notes: z.string().max(2000).nullable().optional(),
});
const idParamsSchema = z.object({ id: uuidSchema });
const workspaceMemberParamsSchema = z.object({ workspaceId: uuidSchema, userId: uuidSchema });
const workspaceRoleBodySchema = z.object({
  role: z.enum(['OWNER', 'ADMIN', 'PMO_SENIOR', 'MANAGER', 'MEMBER', 'VIEWER']),
});

const tenantRoles = new Set(['OWNER', 'TENANT_ADMIN', 'MEMBER', 'GUEST']);
const workspaceRoles = new Set(['OWNER', 'ADMIN', 'PMO_SENIOR', 'MANAGER', 'MEMBER', 'VIEWER']);

type PolicyRow = {
  id: string;
  scope_type: AuthorizationScopeTypeV2;
  scope_id: string;
  subject_type: AuthorizationSubjectTypeV2;
  subject_key: string;
  permission_key: string;
  effect: AuthorizationEffectV2;
  notes: string | null;
  created_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
};

function serializePolicy(row: PolicyRow) {
  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    subjectType: row.subject_type,
    subjectKey: row.subject_key,
    permissionKey: row.permission_key,
    effect: row.effect,
    notes: row.notes,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

async function scopeWorkspaceId(
  tx: Prisma.TransactionClient,
  tenantId: string,
  scopeType: AuthorizationScopeTypeV2,
  scopeId: string,
): Promise<string | null | undefined> {
  if (scopeType === 'TENANT') return scopeId === tenantId ? null : undefined;
  if (scopeType === 'WORKSPACE') {
    const workspace = await tx.workspace.findFirst({ where: { id: scopeId, tenantId }, select: { id: true } });
    return workspace?.id;
  }
  const project = await tx.nexusObject.findFirst({
    where: { id: scopeId, tenantId, objectTypeKey: 'PROJECT', deletedAt: null },
    select: { workspaceId: true },
  });
  return project?.workspaceId;
}

async function validateSubject(
  tx: Prisma.TransactionClient,
  tenantId: string,
  workspaceId: string | null,
  subjectType: AuthorizationSubjectTypeV2,
  subjectKey: string,
): Promise<boolean> {
  if (subjectType === 'TENANT_ROLE') return tenantRoles.has(subjectKey);
  if (subjectType === 'WORKSPACE_ROLE') return Boolean(workspaceId && workspaceRoles.has(subjectKey));
  if (!z.string().uuid().safeParse(subjectKey).success) return false;
  const membership = await tx.tenantMembership.findUnique({
    where: { tenantId_userId: { tenantId, userId: subjectKey } },
    select: { status: true },
  });
  return membership?.status === 'ACTIVE';
}

export async function authorizationV2Routes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/authorization/permissions',
    { preHandler: [authenticate, resolveActor] },
    async (request) => ({
      version: 2,
      permissions: PERMISSIONS_V2,
      workspaceRoles: [...workspaceRoles],
      precedence: [
        'BREAK_GLASS_OWNER_FOR_TENANT_PERMISSION_ADMIN',
        'EXPLICIT_DENY',
        'EXPLICIT_ALLOW',
        'BASE_ROLE',
        'DEFAULT_DENY',
      ],
      actorRole: request.actor!.role,
    }),
  );

  app.get(
    '/api/v1/authorization/effective',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const query = effectiveQuerySchema.safeParse(request.query);
      if (!query.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const decisionMap = await authorizePermissions(tx, actor, PERMISSIONS_V2, {
          workspaceId: query.data.workspaceId ?? null,
          projectId: query.data.projectId ?? null,
        });
        return PERMISSIONS_V2.map((permission) => {
          const decision = decisionMap.get(permission)!;
          return {
            permission,
            allowed: decision.allowed,
            source: decision.source,
            matchedPolicyCount: decision.matchedPolicies.length,
          };
        });
      });
      return {
        version: 2,
        tenantId: actor.tenantId,
        userId: actor.userId,
        workspaceId: query.data.workspaceId ?? null,
        projectId: query.data.projectId ?? null,
        decisions: result,
      };
    },
  );

  app.patch(
    '/api/v1/authorization/workspaces/:workspaceId/members/:userId/role',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = workspaceMemberParamsSchema.safeParse(request.params);
      const body = workspaceRoleBodySchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send({ error: 'validation_error' });
      }
      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const workspace = await tx.workspace.findFirst({
          where: { id: params.data.workspaceId, tenantId: actor.tenantId },
          select: { id: true },
        });
        if (!workspace) return { kind: 'not_found' as const };
        if (!(await canManageWorkspacePermissions(tx, actor, workspace.id))) {
          return { kind: 'forbidden' as const };
        }

        const membership = await tx.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: workspace.id, userId: params.data.userId } },
          select: { id: true, tenantId: true, role: true, workspaceId: true, userId: true },
        });
        if (!membership || membership.tenantId !== actor.tenantId) {
          return { kind: 'membership_not_found' as const };
        }

        const previousRole = String(membership.role) as WorkspaceRoleKeyV2;
        if (!canTransitionWorkspaceRoleV2({
          actorTenantRole: actor.role,
          currentRole: previousRole,
          nextRole: body.data.role,
        })) {
          return { kind: 'owner_role_change_denied' as const };
        }

        if (previousRole === body.data.role) {
          return {
            kind: 'ok' as const,
            membership: {
              workspaceId: membership.workspaceId,
              userId: membership.userId,
              role: previousRole,
            },
          };
        }

        const updated = await tx.workspaceMember.update({
          where: { id: membership.id },
          data: { role: body.data.role },
          select: { workspaceId: true, userId: true, role: true },
        });

        await Promise.all([
          tx.auditLog.create({
            data: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              action: 'WORKSPACE_MEMBER_ROLE_UPDATED',
              resource: 'WORKSPACE_MEMBER',
              resourceId: membership.id,
              correlationId: request.id,
              ipAddress: request.ip,
              details: {
                workspaceId: workspace.id,
                targetUserId: params.data.userId,
                previousRole,
                role: String(updated.role),
              },
            },
          }),
          tx.domainEvent.create({
            data: {
              tenantId: actor.tenantId,
              aggregateId: membership.id,
              eventType: 'bridata.authorization.workspace-role.changed',
              idempotencyKey: `workspace-role:${membership.id}:${request.id}`,
              payload: {
                workspaceId: workspace.id,
                targetUserId: params.data.userId,
                previousRole,
                role: String(updated.role),
                actorId: actor.userId,
              },
            },
          }),
        ]);

        return {
          kind: 'ok' as const,
          membership: {
            workspaceId: updated.workspaceId,
            userId: updated.userId,
            role: String(updated.role),
          },
        };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'workspace_not_found' });
      if (result.kind === 'membership_not_found') return reply.code(404).send({ error: 'workspace_membership_not_found' });
      if (result.kind === 'owner_role_change_denied') return reply.code(403).send({ error: 'workspace_owner_role_change_requires_tenant_admin' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_permission_management_denied' });
      return result.membership;
    },
  );

  app.get(
    '/api/v1/authorization/policies',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const query = policyListQuerySchema.safeParse(request.query);
      if (!query.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        let effectiveWorkspaceId = query.data.workspaceId ?? null;
        if (query.data.projectId) {
          const project = await tx.nexusObject.findFirst({
            where: { id: query.data.projectId, tenantId: actor.tenantId, objectTypeKey: 'PROJECT', deletedAt: null },
            select: { workspaceId: true },
          });
          if (!project) return { kind: 'not_found' as const };
          effectiveWorkspaceId = project.workspaceId;
          if (!(await canManageWorkspacePermissions(tx, actor, project.workspaceId))) return { kind: 'forbidden' as const };
        } else if (effectiveWorkspaceId) {
          if (!(await canManageWorkspacePermissions(tx, actor, effectiveWorkspaceId))) return { kind: 'forbidden' as const };
        } else if (!isTenantAdministrator(actor)) {
          return { kind: 'forbidden' as const };
        }

        const rows = query.data.projectId
          ? await tx.$queryRaw<PolicyRow[]>(Prisma.sql`
              SELECT * FROM authorization_policies
              WHERE tenant_id = ${actor.tenantId}::uuid
                AND ((scope_type = 'TENANT' AND scope_id = ${actor.tenantId}::uuid)
                  OR (scope_type = 'WORKSPACE' AND scope_id = ${effectiveWorkspaceId}::uuid)
                  OR (scope_type = 'PROJECT' AND scope_id = ${query.data.projectId}::uuid))
              ORDER BY scope_type, permission_key, subject_type, subject_key
            `)
          : effectiveWorkspaceId
            ? await tx.$queryRaw<PolicyRow[]>(Prisma.sql`
                SELECT * FROM authorization_policies
                WHERE tenant_id = ${actor.tenantId}::uuid
                  AND ((scope_type = 'TENANT' AND scope_id = ${actor.tenantId}::uuid)
                    OR (scope_type = 'WORKSPACE' AND scope_id = ${effectiveWorkspaceId}::uuid))
                ORDER BY scope_type, permission_key, subject_type, subject_key
              `)
            : await tx.$queryRaw<PolicyRow[]>(Prisma.sql`
                SELECT * FROM authorization_policies
                WHERE tenant_id = ${actor.tenantId}::uuid
                ORDER BY scope_type, scope_id, permission_key, subject_type, subject_key
              `);
        return { kind: 'ok' as const, rows };
      });
      if (result.kind === 'not_found') return reply.code(404).send({ error: 'project_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'permission_policy_management_denied' });
      return { policies: result.rows.map(serializePolicy) };
    },
  );

  app.put(
    '/api/v1/authorization/policies',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const body = policyBodySchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'validation_error', details: body.error.flatten() });
      if (!isPermissionKeyV2(body.data.permissionKey)) {
        return reply.code(400).send({ error: 'unknown_permission_key' });
      }
      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const workspaceId = await scopeWorkspaceId(tx, actor.tenantId, body.data.scopeType, body.data.scopeId);
        if (workspaceId === undefined) return { kind: 'scope_not_found' as const };

        if (body.data.scopeType === 'TENANT') {
          const decision = await authorizePermission(tx, actor, 'tenant.manage_permissions');
          if (!decision.allowed) return { kind: 'forbidden' as const };
        } else if (!workspaceId || !(await canManageWorkspacePermissions(tx, actor, workspaceId))) {
          return { kind: 'forbidden' as const };
        }

        if (!(await validateSubject(tx, actor.tenantId, workspaceId, body.data.subjectType, body.data.subjectKey))) {
          return { kind: 'invalid_subject' as const };
        }

        const rows = await tx.$queryRaw<PolicyRow[]>(Prisma.sql`
          INSERT INTO authorization_policies
            (tenant_id, scope_type, scope_id, subject_type, subject_key, permission_key,
             effect, created_by_user_id, notes, updated_at)
          VALUES
            (${actor.tenantId}::uuid, ${body.data.scopeType}, ${body.data.scopeId}::uuid,
             ${body.data.subjectType}, ${body.data.subjectKey}, ${body.data.permissionKey},
             ${body.data.effect}, ${actor.userId}::uuid, ${body.data.notes ?? null}, CURRENT_TIMESTAMP)
          ON CONFLICT (tenant_id, scope_type, scope_id, subject_type, subject_key, permission_key)
          DO UPDATE SET effect = EXCLUDED.effect, notes = EXCLUDED.notes,
                        created_by_user_id = EXCLUDED.created_by_user_id, updated_at = CURRENT_TIMESTAMP
          RETURNING *
        `);
        const row = rows[0]!;
        await Promise.all([
          tx.domainEvent.create({
            data: {
              tenantId: actor.tenantId,
              aggregateId: row.id,
              eventType: 'bridata.authorization.policy.changed',
              idempotencyKey: `auth-policy:${row.id}:${request.id}`,
              payload: {
                policyId: row.id,
                scopeType: row.scope_type,
                scopeId: row.scope_id,
                subjectType: row.subject_type,
                subjectKey: row.subject_key,
                permissionKey: row.permission_key,
                effect: row.effect,
                actorId: actor.userId,
              },
            },
          }),
          tx.auditLog.create({
            data: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              action: 'AUTHORIZATION_POLICY_UPSERTED',
              resource: 'AUTHORIZATION_POLICY',
              resourceId: row.id,
              correlationId: request.id,
              ipAddress: request.ip,
              details: {
                scopeType: row.scope_type,
                scopeId: row.scope_id,
                subjectType: row.subject_type,
                subjectKey: row.subject_key,
                permissionKey: row.permission_key,
                effect: row.effect,
              },
            },
          }),
        ]);
        return { kind: 'ok' as const, row };
      });
      if (result.kind === 'scope_not_found') return reply.code(404).send({ error: 'authorization_scope_not_found' });
      if (result.kind === 'invalid_subject') return reply.code(400).send({ error: 'authorization_subject_invalid' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'permission_policy_management_denied' });
      return serializePolicy(result.row);
    },
  );

  app.delete(
    '/api/v1/authorization/policies/:id',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = idParamsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const rows = await tx.$queryRaw<PolicyRow[]>(Prisma.sql`
          SELECT * FROM authorization_policies
          WHERE id = ${params.data.id}::uuid AND tenant_id = ${actor.tenantId}::uuid
        `);
        const row = rows[0];
        if (!row) return { kind: 'not_found' as const };
        const workspaceId = await scopeWorkspaceId(tx, actor.tenantId, row.scope_type, row.scope_id);
        if (row.scope_type === 'TENANT') {
          const decision = await authorizePermission(tx, actor, 'tenant.manage_permissions');
          if (!decision.allowed) return { kind: 'forbidden' as const };
        } else if (!workspaceId || !(await canManageWorkspacePermissions(tx, actor, workspaceId))) {
          return { kind: 'forbidden' as const };
        }
        await tx.$executeRaw(Prisma.sql`
          DELETE FROM authorization_policies WHERE id = ${row.id}::uuid AND tenant_id = ${actor.tenantId}::uuid
        `);
        await Promise.all([
          tx.domainEvent.create({
            data: {
              tenantId: actor.tenantId,
              aggregateId: row.id,
              eventType: 'bridata.authorization.policy.deleted',
              idempotencyKey: `auth-policy-delete:${row.id}:${request.id}`,
              payload: {
                policyId: row.id,
                scopeType: row.scope_type,
                scopeId: row.scope_id,
                subjectType: row.subject_type,
                subjectKey: row.subject_key,
                permissionKey: row.permission_key,
                previousEffect: row.effect,
                actorId: actor.userId,
              },
            },
          }),
          tx.auditLog.create({
            data: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              action: 'AUTHORIZATION_POLICY_DELETED',
              resource: 'AUTHORIZATION_POLICY',
              resourceId: row.id,
              correlationId: request.id,
              ipAddress: request.ip,
              details: { permissionKey: row.permission_key, subjectType: row.subject_type, subjectKey: row.subject_key },
            },
          }),
        ]);
        return { kind: 'ok' as const };
      });
      if (result.kind === 'not_found') return reply.code(404).send({ error: 'authorization_policy_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'permission_policy_management_denied' });
      return reply.code(204).send();
    },
  );
}
