export type DataMode = 'mock' | 'api';
export type WebAuthMode = 'dev' | 'entra';

function resolveDataMode(value: string | undefined): DataMode {
  return value === 'api' ? 'api' : 'mock';
}

function resolveAuthMode(value: string | undefined): WebAuthMode {
  return value === 'entra' ? 'entra' : 'dev';
}

function normalizeBaseUrl(value: string | undefined): string {
  const url = (value || 'http://localhost:8080').trim();
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function optionalTrimmed(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export const runtimeConfig = Object.freeze({
  dataMode: resolveDataMode(import.meta.env.VITE_DATA_MODE),
  authMode: resolveAuthMode(import.meta.env.VITE_AUTH_MODE),
  apiBaseUrl: normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL),
  entraWebClientId: optionalTrimmed(import.meta.env.VITE_ENTRA_WEB_CLIENT_ID),
  entraTenantId: optionalTrimmed(import.meta.env.VITE_ENTRA_TENANT_ID),
  entraApiScope: optionalTrimmed(import.meta.env.VITE_ENTRA_API_SCOPE),
});
