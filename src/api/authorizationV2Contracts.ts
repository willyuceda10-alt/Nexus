export type ApiPermissionKeyV2 =
  | 'tenant.read'
  | 'tenant.manage_members'
  | 'tenant.manage_integrations'
  | 'tenant.manage_automation'
  | 'tenant.manage_permissions'
  | 'workspace.read'
  | 'workspace.manage'
  | 'workspace.manage_permissions'
  | 'workspace.manage_automation'
  | 'project.read'
  | 'project.manage'
  | 'project.schedule.read'
  | 'project.schedule.write'
  | 'project.material.read'
  | 'project.material.write'
  | 'project.cost.read'
  | 'project.cost.write'
  | 'project.baseline.create'
  | 'governance.read'
  | 'governance.write'
  | 'meetings.read'
  | 'meetings.write'
  | 'documents.read'
  | 'documents.write';

export type ApiAuthorizationScopeTypeV2 = 'TENANT' | 'WORKSPACE' | 'PROJECT';
export type ApiAuthorizationSubjectTypeV2 = 'USER' | 'TENANT_ROLE' | 'WORKSPACE_ROLE';
export type ApiAuthorizationEffectV2 = 'ALLOW' | 'DENY';

export interface ApiEffectivePermissionDecisionV2 {
  permission: ApiPermissionKeyV2;
  allowed: boolean;
  source: 'BREAK_GLASS_OWNER' | 'EXPLICIT_DENY' | 'EXPLICIT_ALLOW' | 'BASE_ROLE' | 'DEFAULT_DENY';
  matchedPolicyCount: number;
}

export interface ApiEffectivePermissionsV2 {
  version: 2;
  tenantId: string;
  userId: string;
  workspaceId: string | null;
  projectId: string | null;
  decisions: ApiEffectivePermissionDecisionV2[];
}

export interface ApiAuthorizationPolicyV2 {
  id: string;
  scopeType: ApiAuthorizationScopeTypeV2;
  scopeId: string;
  subjectType: ApiAuthorizationSubjectTypeV2;
  subjectKey: string;
  permissionKey: ApiPermissionKeyV2;
  effect: ApiAuthorizationEffectV2;
  notes: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertAuthorizationPolicyV2Input {
  scopeType: ApiAuthorizationScopeTypeV2;
  scopeId: string;
  subjectType: ApiAuthorizationSubjectTypeV2;
  subjectKey: string;
  permissionKey: ApiPermissionKeyV2;
  effect: ApiAuthorizationEffectV2;
  notes?: string | null;
}
