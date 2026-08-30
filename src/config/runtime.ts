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

function normalizeOptional(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

const entraWebClientId = normalizeOptional(
  import.meta.env.VITE_ENTRA_WEB_CLIENT_ID,
);

const entraApiScope = normalizeOptional(
  import.meta.env.VITE_ENTRA_API_SCOPE,
);

export const runtimeConfig = Object.freeze({
  dataMode: resolveDataMode(import.meta.env.VITE_DATA_MODE),
  apiBaseUrl: normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL),
  authMode: resolveAuthMode(import.meta.env.VITE_AUTH_MODE),

  // SaaS multitenant: users authenticate against their own
  // Microsoft Entra organization, not a Bridata-fixed tenant.
  entraAuthority: 'https://login.microsoftonline.com/organizations',

  entraWebClientId,
  entraApiScope,

  entraConfigured:
    Boolean(entraWebClientId) &&
    Boolean(entraApiScope),
});
