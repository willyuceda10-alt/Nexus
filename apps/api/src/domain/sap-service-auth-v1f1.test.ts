import { describe, expect, it } from 'vitest';
import {
  applicationRolesV1f1,
  hasIntegrationImportRoleV1f1,
  isAllowedSapSourceV1f1,
  isApplicationTokenV1f1,
  serviceClientIdV1f1,
} from './sap-service-auth-v1f1.js';

describe('SAP service authorization V1-F1', () => {
  it('accepts an app-only token with the governed import app role', () => {
    const claims = {
      roles: ['Bridata.Integration.Import'],
      azp: '11111111-1111-4111-8111-111111111111',
    };
    expect(isApplicationTokenV1f1(claims)).toBe(true);
    expect(hasIntegrationImportRoleV1f1(claims)).toBe(true);
    expect(serviceClientIdV1f1(claims)).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('rejects delegated user tokens even when a roles claim is present', () => {
    const claims = { scp: 'access_as_user', roles: ['Bridata.Integration.Import'] };
    expect(isApplicationTokenV1f1(claims)).toBe(false);
    expect(hasIntegrationImportRoleV1f1(claims)).toBe(false);
  });

  it('rejects app-only tokens without the required role', () => {
    expect(hasIntegrationImportRoleV1f1({ roles: ['Other.Role'] })).toBe(false);
    expect(applicationRolesV1f1({ roles: 'Bridata.Integration.Import' })).toEqual([]);
  });

  it('supports azp and legacy appid client identifiers', () => {
    expect(serviceClientIdV1f1({ azp: ' a ' })).toBe('a');
    expect(serviceClientIdV1f1({ appid: ' b ' })).toBe('b');
    expect(serviceClientIdV1f1({})).toBeNull();
  });

  it('authorizes only explicitly allowed SAP logical source keys', () => {
    expect(isAllowedSapSourceV1f1(['SAP_PROJECT_PROCUREMENT'], 'sap_project_procurement')).toBe(true);
    expect(isAllowedSapSourceV1f1(['SAP_PROJECT_PROCUREMENT'], 'SAP_PROJECT_ACTUAL_COSTS')).toBe(false);
  });
});
