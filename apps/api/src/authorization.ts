import { Prisma } from '@prisma/client';
import type { ActorContext } from './auth.js';
import {
  evaluatePermissionV2,
  type AuthorizationEffectV2,
  type AuthorizationScopeTypeV2,
  type AuthorizationSubjectTypeV2,
  type PermissionDecisionV2,
  type PermissionKeyV2,
  type PermissionPolicyV2,
} from './domain/permission-engine-v2.js';

export interface AuthorizationContextV2 {
  workspaceId?: string | null;
  projectId?: string | null;
}

type PolicyRow = {
  scope_type: AuthorizationScopeTypeV2;
  scope_id: string;
  subject_type: AuthorizationSubjectTypeV2;
  subject_key: string;
  permission_key: PermissionKeyV2;
  effect: AuthorizationEffectV2;
};

export function isTenantAdministrator(actor: ActorContext): boolean {
  return actor.role === 'OWNER' || actor.role === 'TENANT_ADMIN';
}

async function resolveWorkspaceContext(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  context: AuthorizationContextV2,
): Promise<{ workspaceId: string | null; workspaceRole: string | null; projectId: string | null } | null> {
  let workspaceId = context.workspaceId ?? null;
  const projectId = context.projectId ?? null;

  if (projectId) {
    const project = await tx.nexusObject.findFirst({
      where: {
        id: projectId,
        tenantId: actor.tenantId,
        objectTypeKey: 'PROJECT',
        deletedAt: null,
      },
      select: { workspaceId: true },
    });
    if (!project) return null;
    if (workspaceId && workspaceId !== project.workspaceId) return null;
    workspaceId = project.workspaceId;
  }

  if (!workspaceId) {
    return { workspaceId: null, workspaceRole: null, projectId };
  }

  const workspace = await tx.workspace.findFirst({
    where: { id: workspaceId, tenantId: actor.tenantId },
    select: { id: true },
  });
  if (!workspace) return null;

  if (isTenantAdministrator(actor)) {
    return { workspaceId, workspaceRole: null, projectId };
  }

  const membership = await tx.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: actor.userId } },
    select: { tenantId: true, role: true },
  });

  return {
    workspaceId,
    workspaceRole: membership?.tenantId === actor.tenantId ? membership.role : null,
    projectId,
  };
}

async function loadPolicies(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  permission: PermissionKeyV2,
  context: { workspaceId: string | null; projectId: string | null },
): Promise<PermissionPolicyV2[]> {
  const rows = await tx.$queryRaw<PolicyRow[]>(Prisma.sql`
    SELECT scope_type, scope_id, subject_type, subject_key, permission_key, effect
    FROM authorization_policies
    WHERE tenant_id = ${actor.tenantId}::uuid
      AND permission_key = ${permission}
      AND (
        (scope_type = 'TENANT' AND scope_id = ${actor.tenantId}::uuid)
        OR (${context.workspaceId}::uuid IS NOT NULL AND scope_type = 'WORKSPACE' AND scope_id = ${context.workspaceId}::uuid)
        OR (${context.projectId}::uuid IS NOT NULL AND scope_type = 'PROJECT' AND scope_id = ${context.projectId}::uuid)
      )
  `);

  return rows.map((row) => ({
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    subjectType: row.subject_type,
    subjectKey: row.subject_key,
    permissionKey: row.permission_key,
    effect: row.effect,
  }));
}

export async function authorizePermission(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  permission: PermissionKeyV2,
  context: AuthorizationContextV2 = {},
): Promise<PermissionDecisionV2> {
  const resolved = await resolveWorkspaceContext(tx, actor, context);
  if (!resolved) {
    return { allowed: false, source: 'DEFAULT_DENY', matchedPolicies: [] };
  }

  // Non-admin users need workspace membership before role or policy evaluation.
  if (resolved.workspaceId && !isTenantAdministrator(actor) && !resolved.workspaceRole) {
    return { allowed: false, source: 'DEFAULT_DENY', matchedPolicies: [] };
  }

  const policies = await loadPolicies(tx, actor, permission, resolved);
  return evaluatePermissionV2({
    tenantId: actor.tenantId,
    userId: actor.userId,
    tenantRole: actor.role,
    workspaceRole: resolved.workspaceRole,
    workspaceId: resolved.workspaceId,
    projectId: resolved.projectId,
    permission,
    policies,
  });
}

export async function canAccessWorkspace(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  workspaceId: string,
): Promise<boolean> {
  return (await authorizePermission(tx, actor, 'workspace.read', { workspaceId })).allowed;
}

export async function canManageWorkspace(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  workspaceId: string,
): Promise<boolean> {
  return (await authorizePermission(tx, actor, 'workspace.manage', { workspaceId })).allowed;
}

export async function canManageWorkspacePermissions(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  workspaceId: string,
): Promise<boolean> {
  return (await authorizePermission(tx, actor, 'workspace.manage_permissions', { workspaceId })).allowed;
}

export async function canAccessProject(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  projectId: string,
): Promise<boolean> {
  return (await authorizePermission(tx, actor, 'project.read', { projectId })).allowed;
}

export async function canManageProject(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  projectId: string,
): Promise<boolean> {
  return (await authorizePermission(tx, actor, 'project.manage', { projectId })).allowed;
}
