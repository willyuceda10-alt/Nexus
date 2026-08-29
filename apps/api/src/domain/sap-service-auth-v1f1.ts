export const SAP_INTEGRATION_IMPORT_APP_ROLE_V1F1 = 'Bridata.Integration.Import';

export type SapServiceTokenClaimsV1f1 = {
  roles?: unknown;
  scp?: unknown;
  azp?: unknown;
  appid?: unknown;
  tid?: unknown;
};

export function applicationRolesV1f1(claims: SapServiceTokenClaimsV1f1): string[] {
  return Array.isArray(claims.roles)
    ? claims.roles.filter((role): role is string => typeof role === 'string' && role.trim().length > 0)
    : [];
}

export function serviceClientIdV1f1(claims: SapServiceTokenClaimsV1f1): string | null {
  const raw = typeof claims.azp === 'string'
    ? claims.azp
    : typeof claims.appid === 'string'
      ? claims.appid
      : null;
  return raw?.trim() || null;
}

export function isApplicationTokenV1f1(claims: SapServiceTokenClaimsV1f1): boolean {
  return !(typeof claims.scp === 'string' && claims.scp.trim().length > 0);
}

export function hasIntegrationImportRoleV1f1(
  claims: SapServiceTokenClaimsV1f1,
  requiredRole: string = SAP_INTEGRATION_IMPORT_APP_ROLE_V1F1,
): boolean {
  return isApplicationTokenV1f1(claims) && applicationRolesV1f1(claims).includes(requiredRole);
}

export function isAllowedSapSourceV1f1(allowedSourceKeys: readonly string[], sourceKey: string): boolean {
  const normalized = sourceKey.trim().toUpperCase();
  return allowedSourceKeys.some((candidate) => candidate.trim().toUpperCase() === normalized);
}
