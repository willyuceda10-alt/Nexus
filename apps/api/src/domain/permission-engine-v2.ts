export const PERMISSIONS_V2 = [
  'tenant.read',
  'tenant.manage_members',
  'tenant.manage_integrations',
  'tenant.manage_automation',
  'tenant.manage_permissions',
  'workspace.read',
  'workspace.manage',
  'workspace.manage_permissions',
  'workspace.manage_automation',
  'project.read',
  'project.manage',
  'project.schedule.read',
  'project.schedule.write',
  'project.material.read',
  'project.material.write',
  'project.cost.read',
  'project.cost.write',
  'project.baseline.create',
  'governance.read',
  'governance.write',
  'meetings.read',
  'meetings.write',
  'documents.read',
  'documents.write',
] as const;

export type PermissionKeyV2 = (typeof PERMISSIONS_V2)[number];
export type AuthorizationEffectV2 = 'ALLOW' | 'DENY';
export type AuthorizationScopeTypeV2 = 'TENANT' | 'WORKSPACE' | 'PROJECT';
export type AuthorizationSubjectTypeV2 = 'USER' | 'TENANT_ROLE' | 'WORKSPACE_ROLE';

export interface PermissionPolicyV2 {
  scopeType: AuthorizationScopeTypeV2;
  scopeId: string;
  subjectType: AuthorizationSubjectTypeV2;
  subjectKey: string;
  permissionKey: PermissionKeyV2;
  effect: AuthorizationEffectV2;
}

export interface PermissionDecisionInputV2 {
  tenantId: string;
  userId: string;
  tenantRole: string;
  workspaceRole?: string | null;
  workspaceId?: string | null;
  projectId?: string | null;
  permission: PermissionKeyV2;
  policies: PermissionPolicyV2[];
}

export interface PermissionDecisionV2 {
  allowed: boolean;
  source: 'BREAK_GLASS_OWNER' | 'EXPLICIT_DENY' | 'EXPLICIT_ALLOW' | 'BASE_ROLE' | 'DEFAULT_DENY';
  matchedPolicies: PermissionPolicyV2[];
}

const ALL_PERMISSIONS = new Set<PermissionKeyV2>(PERMISSIONS_V2);

const TENANT_ROLE_GRANTS: Record<string, ReadonlySet<PermissionKeyV2>> = {
  OWNER: ALL_PERMISSIONS,
  TENANT_ADMIN: ALL_PERMISSIONS,
  MEMBER: new Set<PermissionKeyV2>(['tenant.read']),
  GUEST: new Set<PermissionKeyV2>([]),
};

const WORKSPACE_ROLE_GRANTS: Record<string, ReadonlySet<PermissionKeyV2>> = {
  OWNER: new Set<PermissionKeyV2>([
    'workspace.read', 'workspace.manage', 'workspace.manage_permissions', 'workspace.manage_automation',
    'project.read', 'project.manage', 'project.schedule.read', 'project.schedule.write',
    'project.material.read', 'project.material.write', 'project.cost.read', 'project.cost.write',
    'project.baseline.create', 'governance.read', 'governance.write', 'meetings.read', 'meetings.write',
    'documents.read', 'documents.write',
  ]),
  ADMIN: new Set<PermissionKeyV2>([
    'workspace.read', 'workspace.manage', 'workspace.manage_permissions', 'workspace.manage_automation',
    'project.read', 'project.manage', 'project.schedule.read', 'project.schedule.write',
    'project.material.read', 'project.material.write', 'project.cost.read', 'project.cost.write',
    'project.baseline.create', 'governance.read', 'governance.write', 'meetings.read', 'meetings.write',
    'documents.read', 'documents.write',
  ]),
  MANAGER: new Set<PermissionKeyV2>([
    'workspace.read', 'workspace.manage', 'workspace.manage_automation', 'project.read', 'project.manage',
    'project.schedule.read', 'project.schedule.write', 'project.material.read', 'project.material.write',
    'project.cost.read', 'project.cost.write', 'project.baseline.create', 'governance.read', 'governance.write',
    'meetings.read', 'meetings.write', 'documents.read', 'documents.write',
  ]),
  MEMBER: new Set<PermissionKeyV2>([
    'workspace.read', 'project.read', 'project.schedule.read', 'project.material.read', 'project.cost.read',
    'governance.read', 'meetings.read', 'meetings.write', 'documents.read', 'documents.write',
  ]),
  VIEWER: new Set<PermissionKeyV2>([
    'workspace.read', 'project.read', 'project.schedule.read', 'project.material.read', 'project.cost.read',
    'governance.read', 'meetings.read', 'documents.read',
  ]),
};

export function isPermissionKeyV2(value: string): value is PermissionKeyV2 {
  return (PERMISSIONS_V2 as readonly string[]).includes(value);
}

function policyScopeMatches(input: PermissionDecisionInputV2, policy: PermissionPolicyV2): boolean {
  if (policy.scopeType === 'TENANT') return policy.scopeId === input.tenantId;
  if (policy.scopeType === 'WORKSPACE') return Boolean(input.workspaceId && policy.scopeId === input.workspaceId);
  return Boolean(input.projectId && policy.scopeId === input.projectId);
}

function policySubjectMatches(input: PermissionDecisionInputV2, policy: PermissionPolicyV2): boolean {
  if (policy.subjectType === 'USER') return policy.subjectKey === input.userId;
  if (policy.subjectType === 'TENANT_ROLE') return policy.subjectKey === input.tenantRole;
  return Boolean(input.workspaceRole && policy.subjectKey === input.workspaceRole);
}

export function baseRoleAllowsPermissionV2(input: PermissionDecisionInputV2): boolean {
  const tenantGrant = TENANT_ROLE_GRANTS[input.tenantRole];
  if (tenantGrant?.has(input.permission)) return true;
  if (!input.workspaceRole) return false;
  return WORKSPACE_ROLE_GRANTS[input.workspaceRole]?.has(input.permission) ?? false;
}

export function evaluatePermissionV2(input: PermissionDecisionInputV2): PermissionDecisionV2 {
  const matchedPolicies = input.policies.filter((policy) =>
    policy.permissionKey === input.permission && policyScopeMatches(input, policy) && policySubjectMatches(input, policy),
  );

  if (input.tenantRole === 'OWNER' && input.permission === 'tenant.manage_permissions') {
    return { allowed: true, source: 'BREAK_GLASS_OWNER', matchedPolicies };
  }

  if (matchedPolicies.some((policy) => policy.effect === 'DENY')) {
    return { allowed: false, source: 'EXPLICIT_DENY', matchedPolicies };
  }
  if (matchedPolicies.some((policy) => policy.effect === 'ALLOW')) {
    return { allowed: true, source: 'EXPLICIT_ALLOW', matchedPolicies };
  }
  if (baseRoleAllowsPermissionV2(input)) {
    return { allowed: true, source: 'BASE_ROLE', matchedPolicies };
  }
  return { allowed: false, source: 'DEFAULT_DENY', matchedPolicies };
}
