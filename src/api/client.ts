import { runtimeConfig } from '../config/runtime';
import type { ApiErrorPayload, BootstrapResponse } from './contracts';

export type AccessTokenProvider = () => Promise<string | null>;
export type TenantIdProvider = () => string | null;

let accessTokenProvider: AccessTokenProvider | null = null;
let tenantIdProvider: TenantIdProvider | null = null;

export function configureApiSession(options: {
  getAccessToken?: AccessTokenProvider | null;
  getTenantId?: TenantIdProvider | null;
}): void {
  accessTokenProvider = options.getAccessToken ?? null;
  tenantIdProvider = options.getTenantId ?? null;
}

export class BridataApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly correlationId?: string;
  readonly details?: unknown;

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message || `Bridata Project API request failed (${status})`);
    this.name = 'BridataApiError';
    this.status = status;
    this.code = payload.error;
    this.correlationId = payload.correlationId;
    this.details = payload.details;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = accessTokenProvider ? await accessTokenProvider() : null;
  const tenantId = tenantIdProvider?.() ?? null;
  const headers = new Headers(init.headers);

  headers.set('accept', 'application/json');
  headers.set('x-correlation-id', crypto.randomUUID());

  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  }

  if (tenantId) {
    headers.set('x-bridata-tenant-id', tenantId);
  }

  const response = await fetch(`${runtimeConfig.apiBaseUrl}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    let payload: ApiErrorPayload = {};
    try {
      payload = (await response.json()) as ApiErrorPayload;
    } catch {
      payload = { message: response.statusText };
    }
    throw new BridataApiError(response.status, payload);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const bridataApi = {
  bootstrap(signal?: AbortSignal): Promise<BootstrapResponse> {
    return request<BootstrapResponse>('/api/v1/bootstrap', { signal });
  },
};
