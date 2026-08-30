import { describe, expect, it } from 'vitest';
import { validateEntraTenantClaims } from './entra-multitenant-auth-h44.js';

const TENANT_A = '3720dd64-a171-4ca6-98eb-53cfcde73e8c';
const TENANT_B = '11111111-2222-4333-8444-555555555555';

describe('Entra multitenant authentication H4.4', () => {
  it('accepts a valid external Microsoft tenant in SaaS mode', () => {
    expect(
      validateEntraTenantClaims({
        tenantId: TENANT_B,
        issuer: `https://login.microsoftonline.com/${TENANT_B}/v2.0`,
        scopes: ['openid', 'profile', 'access_as_user'],
        requiredScope: 'access_as_user',
      }),
    ).toEqual({
      tenantId: TENANT_B,
      issuer: `https://login.microsoftonline.com/${TENANT_B}/v2.0`,
    });
  });

  it('resolves the expected issuer before delegated scopes are trusted', () => {
    expect(
      validateEntraTenantClaims({
        tenantId: TENANT_B,
      }),
    ).toEqual({
      tenantId: TENANT_B,
      issuer: `https://login.microsoftonline.com/${TENANT_B}/v2.0`,
    });
  });

  it('rejects an invalid tenant id', () => {
    expect(() =>
      validateEntraTenantClaims({
        tenantId: 'not-a-guid',
        scopes: ['access_as_user'],
        requiredScope: 'access_as_user',
      }),
    ).toThrow('valid Entra tenant id');
  });

  it('rejects another tenant when a dedicated tenant is configured', () => {
    expect(() =>
      validateEntraTenantClaims({
        tenantId: TENANT_B,
        configuredTenantId: TENANT_A,
        scopes: ['access_as_user'],
        requiredScope: 'access_as_user',
      }),
    ).toThrow('unexpected Entra tenant');
  });

  it('rejects an issuer that does not match the tenant', () => {
    expect(() =>
      validateEntraTenantClaims({
        tenantId: TENANT_B,
        issuer: `https://login.microsoftonline.com/${TENANT_A}/v2.0`,
        scopes: ['access_as_user'],
        requiredScope: 'access_as_user',
      }),
    ).toThrow('issuer does not match');
  });

  it('rejects a token without the required delegated scope', () => {
    expect(() =>
      validateEntraTenantClaims({
        tenantId: TENANT_B,
        issuer: `https://login.microsoftonline.com/${TENANT_B}/v2.0`,
        scopes: ['openid', 'profile'],
        requiredScope: 'access_as_user',
      }),
    ).toThrow('required delegated API scope');
  });
});
