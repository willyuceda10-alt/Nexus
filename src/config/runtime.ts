export type DataMode = 'mock' | 'api';

function resolveDataMode(value: string | undefined): DataMode {
  return value === 'api' ? 'api' : 'mock';
}

function normalizeBaseUrl(value: string | undefined): string {
  const url = (value || 'http://localhost:8080').trim();
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export const runtimeConfig = Object.freeze({
  dataMode: resolveDataMode(import.meta.env.VITE_DATA_MODE),
  apiBaseUrl: normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL),
});
