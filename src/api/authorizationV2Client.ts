import { request } from './client';

export type WorkspaceRoleV2 = 'OWNER' | 'ADMIN' | 'PMO_SENIOR' | 'MANAGER' | 'MEMBER' | 'VIEWER';

export interface WorkspaceMemberV1 {
  membershipId: string;
  userId: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  isActive: boolean;
  role: WorkspaceRoleV2;
  joinedAt: string;
}

export interface WorkspaceMembersV1Response {
  workspace: { id: string; name: string };
  roles: WorkspaceRoleV2[];
  items: WorkspaceMemberV1[];
}

export interface EffectivePermissionV2 {
  permission: string;
  allowed: boolean;
  source: 'BREAK_GLASS_OWNER' | 'EXPLICIT_DENY' | 'EXPLICIT_ALLOW' | 'BASE_ROLE' | 'DEFAULT_DENY';
  matchedPolicyCount: number;
}

export interface EffectivePermissionsV2Response {
  version: 2;
  tenantId: string;
  userId: string;
  workspaceId: string | null;
  projectId: string | null;
  decisions: EffectivePermissionV2[];
}

export const authorizationV2Api = {
  effectiveWorkspacePermissions(workspaceId: string, signal?: AbortSignal): Promise<EffectivePermissionsV2Response> {
    const query = new URLSearchParams({ workspaceId });
    return request<EffectivePermissionsV2Response>(`/api/v1/authorization/effective?${query.toString()}`, { signal });
  },

  listWorkspaceMembers(workspaceId: string, signal?: AbortSignal): Promise<WorkspaceMembersV1Response> {
    return request<WorkspaceMembersV1Response>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members-v1`, { signal });
  },

  updateWorkspaceRole(workspaceId: string, userId: string, role: WorkspaceRoleV2): Promise<{ workspaceId: string; userId: string; role: WorkspaceRoleV2 }> {
    return request<{ workspaceId: string; userId: string; role: WorkspaceRoleV2 }>(
      `/api/v1/authorization/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}/role`,
      { method: 'PATCH', body: JSON.stringify({ role }) },
    );
  },
};
