export type EntraTenantValidationInput = {
  tenantId?: string | undefined;
  configuredTenantId?: string | undefined;
  issuer?: string | undefined;
  scopes?: string[] | undefined;
  requiredScope?: string | undefined;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateEntraTenantClaims(
  input: EntraTenantValidationInput,
): { tenantId: string; issuer: string } {
  const tenantId = input.tenantId;

  if (!tenantId || !UUID_PATTERN.test(tenantId)) {
    throw new Error('Token does not contain a valid Entra tenant id (tid).');
  }

  if (input.configuredTenantId && tenantId !== input.configuredTenantId) {
    throw new Error('Token was issued by an unexpected Entra tenant.');
  }

  const expectedIssuer =
    `https://login.microsoftonline.com/${tenantId}/v2.0`;

  if (input.issuer && input.issuer !== expectedIssuer) {
    throw new Error('Token issuer does not match the Entra tenant.');
  }

  if (input.requiredScope && !input.scopes?.includes(input.requiredScope)) {
    throw new Error('Token does not contain the required delegated API scope.');
  }

  return {
    tenantId,
    issuer: expectedIssuer,
  };
}
