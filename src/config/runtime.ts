export type DataMode = 'mock' | 'api';
export type WebAuthMode = 'dev' | 'entra';

// Injected at container startup by docker-entrypoint-web.sh into /runtime-config.js.
// Falls back to VITE_ build-time vars for local dev.
interface BridataRuntimeWindow {
  dataMode?: string;
  authMode?: string;
  apiBaseUrl?: string;
  entraWebClientId?: string;
  entraTenantId?: string;
  entraApiScope?: string;
}

declare global {
  interface Window {
    __BRIDATA_CONFIG__?: BridataRuntimeWindow;
  }
}

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

const rc = typeof window !== 'undefined' ? (window.__BRIDATA_CONFIG__ ?? {}) : {};

export const runtimeConfig = Object.freeze({
  dataMode: resolveDataMode(rc.dataMode ?? import.meta.env.VITE_DATA_MODE),
  authMode: resolveAuthMode(rc.authMode ?? import.meta.env.VITE_AUTH_MODE),
  apiBaseUrl: normalizeBaseUrl(rc.apiBaseUrl ?? import.meta.env.VITE_API_BASE_URL),
  entraWebClientId: optionalTrimmed(rc.entraWebClientId ?? import.meta.env.VITE_ENTRA_WEB_CLIENT_ID),
  entraTenantId: optionalTrimmed(rc.entraTenantId ?? import.meta.env.VITE_ENTRA_TENANT_ID),
  entraApiScope: optionalTrimmed(rc.entraApiScope ?? import.meta.env.VITE_ENTRA_API_SCOPE),
});
