export type DataMode = 'mock' | 'api';
export type AuthMode = 'dev' | 'entra';

function resolveDataMode(value: string | undefined): DataMode {
  return value === 'api' ? 'api' : 'mock';
}

function resolveAuthMode(value: string | undefined): AuthMode {
  return value === 'entra' ? 'entra' : 'dev';
}

function normalizeBaseUrl(value: string | undefined): string {
  const url = (value || 'http://localhost:8080').trim();
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function normalizeValue(value: string | undefined): string {
  return (value || '').trim();
}

const authMode = resolveAuthMode(import.meta.env.VITE_AUTH_MODE);
const webClientId = normalizeValue(import.meta.env.VITE_ENTRA_WEB_CLIENT_ID);
const entraTenantId = normalizeValue(import.meta.env.VITE_ENTRA_TENANT_ID);
const apiScope = normalizeValue(import.meta.env.VITE_ENTRA_API_SCOPE);
const redirectUri = normalizeValue(import.meta.env.VITE_ENTRA_REDIRECT_URI);

const missingEntraFields = [
  !webClientId ? 'VITE_ENTRA_WEB_CLIENT_ID' : null,
  !entraTenantId ? 'VITE_ENTRA_TENANT_ID' : null,
  !apiScope ? 'VITE_ENTRA_API_SCOPE' : null,
].filter((field): field is string => field !== null);

export const runtimeConfig = Object.freeze({
  dataMode: resolveDataMode(import.meta.env.VITE_DATA_MODE),
  apiBaseUrl: normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL),
  authMode,
  authConfigurationError:
    authMode === 'entra' && missingEntraFields.length > 0
      ? `Faltan variables de Microsoft Entra: ${missingEntraFields.join(', ')}`
      : null,
  entra: Object.freeze({
    webClientId,
    tenantId: entraTenantId,
    apiScope,
    redirectUri,
  }),
});
