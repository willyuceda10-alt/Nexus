export const SAP_INTEGRATION_IMPORT_APP_ROLE_V1F1 = 'Bridata.Integration.Import';

export type SapServiceTokenClaimsV1f1 = {
  roles?: unknown;
  scp?: unknown;
  azp?: unknown;
  appid?: unknown;
  tid?: unknown;
};

function claimValueV1f1(claims: unknown, key: keyof SapServiceTokenClaimsV1f1): unknown {
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return undefined;
  return (claims as Record<string, unknown>)[key];
}

export function applicationRolesV1f1(claims: unknown): string[] {
  const roles = claimValueV1f1(claims, 'roles');
  return Array.isArray(roles)
    ? roles.filter((role): role is string => typeof role === 'string' && role.trim().length > 0)
    : [];
}

export function serviceClientIdV1f1(claims: unknown): string | null {
  const azp = claimValueV1f1(claims, 'azp');
  const appid = claimValueV1f1(claims, 'appid');
  const raw = typeof azp === 'string'
    ? azp
    : typeof appid === 'string'
      ? appid
      : null;
  return raw?.trim() || null;
}

export function isApplicationTokenV1f1(claims: unknown): boolean {
  const scp = claimValueV1f1(claims, 'scp');
  return !(typeof scp === 'string' && scp.trim().length > 0);
}

export function hasIntegrationImportRoleV1f1(
  claims: unknown,
  requiredRole: string = SAP_INTEGRATION_IMPORT_APP_ROLE_V1F1,
): boolean {
  return isApplicationTokenV1f1(claims) && applicationRolesV1f1(claims).includes(requiredRole);
}

export function isAllowedSapSourceV1f1(allowedSourceKeys: readonly string[], sourceKey: string): boolean {
  const normalized = sourceKey.trim().toUpperCase();
  return allowedSourceKeys.some((candidate) => candidate.trim().toUpperCase() === normalized);
}
