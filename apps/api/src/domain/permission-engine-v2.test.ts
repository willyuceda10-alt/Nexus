import { describe, expect, it } from 'vitest';
import { evaluatePermissionV2, type PermissionDecisionInputV2 } from './permission-engine-v2.js';

function base(overrides: Partial<PermissionDecisionInputV2> = {}): PermissionDecisionInputV2 {
  return {
    tenantId: '00000000-0000-0000-0000-000000000001',
    userId: '00000000-0000-0000-0000-000000000002',
    tenantRole: 'MEMBER',
    workspaceRole: 'MANAGER',
    workspaceId: '00000000-0000-0000-0000-000000000003',
    projectId: '00000000-0000-0000-0000-000000000004',
    permission: 'project.cost.write',
    policies: [],
    ...overrides,
  };
}

describe('permission engine v2', () => {
  it('preserves manager write access through base role grants', () => {
    expect(evaluatePermissionV2(base())).toMatchObject({ allowed: true, source: 'BASE_ROLE' });
  });

  it('lets MANAGER operate workspace automations without permission administration', () => {
    expect(evaluatePermissionV2(base({ permission: 'workspace.manage_automation' })))
      .toMatchObject({ allowed: true, source: 'BASE_ROLE' });
    expect(evaluatePermissionV2(base({ permission: 'workspace.manage_permissions' })))
      .toMatchObject({ allowed: false, source: 'DEFAULT_DENY' });
  });

  it('gives PMO Senior governed portfolio, schedule, baseline and executive capabilities', () => {
    const governed = [
      'portfolio.manage',
      'project.schedule.write',
      'project.cost.read',
      'project.forecast.write',
      'project.baseline.approve',
      'project.change.approve',
      'resource.capacity.read',
      'governance.write',
      'report.executive.read',
      'audit.read',
    ] as const;

    for (const permission of governed) {
      expect(evaluatePermissionV2(base({ workspaceRole: 'PMO_SENIOR', permission })))
        .toMatchObject({ allowed: true, source: 'BASE_ROLE' });
    }
  });

  it('keeps PMO Senior out of technical administration and SAP-authoritative writes', () => {
    const denied = [
      'workspace.manage_permissions',
      'workspace.manage_automation',
      'project.material.write',
      'project.cost.write',
      'tenant.manage_integrations',
    ] as const;

    for (const permission of denied) {
      expect(evaluatePermissionV2(base({ workspaceRole: 'PMO_SENIOR', permission })))
        .toMatchObject({ allowed: false, source: 'DEFAULT_DENY' });
    }
  });

  it('denies automation management to a viewer by default', () => {
    expect(evaluatePermissionV2(base({ workspaceRole: 'VIEWER', permission: 'workspace.manage_automation' })))
      .toMatchObject({ allowed: false, source: 'DEFAULT_DENY' });
  });

  it('denies by default when no role grants the permission', () => {
    expect(evaluatePermissionV2(base({ workspaceRole: 'VIEWER', permission: 'project.cost.write' })))
      .toMatchObject({ allowed: false, source: 'DEFAULT_DENY' });
  });

  it('allows a scoped user override', () => {
    const input = base({
      workspaceRole: 'VIEWER',
      policies: [{
        scopeType: 'PROJECT',
        scopeId: '00000000-0000-0000-0000-000000000004',
        subjectType: 'USER',
        subjectKey: '00000000-0000-0000-0000-000000000002',
        permissionKey: 'project.cost.write',
        effect: 'ALLOW',
      }],
    });
    expect(evaluatePermissionV2(input)).toMatchObject({ allowed: true, source: 'EXPLICIT_ALLOW' });
  });

  it('makes explicit deny win over explicit allow and base role access', () => {
    const input = base({
      policies: [
        {
          scopeType: 'WORKSPACE',
          scopeId: '00000000-0000-0000-0000-000000000003',
          subjectType: 'WORKSPACE_ROLE',
          subjectKey: 'MANAGER',
          permissionKey: 'project.cost.write',
          effect: 'ALLOW',
        },
        {
          scopeType: 'PROJECT',
          scopeId: '00000000-0000-0000-0000-000000000004',
          subjectType: 'USER',
          subjectKey: '00000000-0000-0000-0000-000000000002',
          permissionKey: 'project.cost.write',
          effect: 'DENY',
        },
      ],
    });
    expect(evaluatePermissionV2(input)).toMatchObject({ allowed: false, source: 'EXPLICIT_DENY' });
  });

  it('lets explicit deny restrict a PMO Senior base permission', () => {
    const input = base({
      workspaceRole: 'PMO_SENIOR',
      permission: 'project.baseline.approve',
      policies: [{
        scopeType: 'WORKSPACE',
        scopeId: '00000000-0000-0000-0000-000000000003',
        subjectType: 'WORKSPACE_ROLE',
        subjectKey: 'PMO_SENIOR',
        permissionKey: 'project.baseline.approve',
        effect: 'DENY',
      }],
    });
    expect(evaluatePermissionV2(input)).toMatchObject({ allowed: false, source: 'EXPLICIT_DENY' });
  });

  it('keeps tenant OWNER as break-glass for permission administration', () => {
    const input = base({
      tenantRole: 'OWNER',
      workspaceRole: null,
      workspaceId: null,
      projectId: null,
      permission: 'tenant.manage_permissions',
      policies: [{
        scopeType: 'TENANT',
        scopeId: '00000000-0000-0000-0000-000000000001',
        subjectType: 'TENANT_ROLE',
        subjectKey: 'OWNER',
        permissionKey: 'tenant.manage_permissions',
        effect: 'DENY',
      }],
    });
    expect(evaluatePermissionV2(input)).toMatchObject({ allowed: true, source: 'BREAK_GLASS_OWNER' });
  });

  it('ignores a policy from another project scope', () => {
    const input = base({
      workspaceRole: 'VIEWER',
      policies: [{
        scopeType: 'PROJECT',
        scopeId: '00000000-0000-0000-0000-000000000099',
        subjectType: 'USER',
        subjectKey: '00000000-0000-0000-0000-000000000002',
        permissionKey: 'project.cost.write',
        effect: 'ALLOW',
      }],
    });
    expect(evaluatePermissionV2(input)).toMatchObject({ allowed: false, source: 'DEFAULT_DENY' });
  });
});
