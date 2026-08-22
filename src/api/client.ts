import { runtimeConfig } from '../config/runtime';
import type {
  ApiBaselineSummary,
  ApiDependency,
  ApiDependencyListResponse,
  ApiErrorPayload,
  ApiNexusObject,
  ApiObjectListResponse,
  ApiScheduleAnalysis,
  BootstrapResponse,
  CreateApiDependencyInput,
  CreateApiObjectInput,
  ListObjectsParams,
  SessionResponse,
  UpdateApiDependencyInput,
  UpdateApiObjectInput,
} from './contracts';

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

function objectListPath(params: ListObjectsParams = {}): string {
  const query = new URLSearchParams();
  if (params.workspaceId) query.set('workspaceId', params.workspaceId);
  if (params.type) query.set('type', params.type);
  if (params.status) query.set('status', params.status);
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', String(params.limit));

  const suffix = query.toString();
  return suffix ? `/api/v1/objects?${suffix}` : '/api/v1/objects';
}

export const bridataApi = {
  session(signal?: AbortSignal): Promise<SessionResponse> {
    return request<SessionResponse>('/api/v1/session', { signal });
  },

  bootstrap(signal?: AbortSignal): Promise<BootstrapResponse> {
    return request<BootstrapResponse>('/api/v1/bootstrap', { signal });
  },

  listObjects(params: ListObjectsParams = {}, signal?: AbortSignal): Promise<ApiObjectListResponse> {
    return request<ApiObjectListResponse>(objectListPath(params), { signal });
  },

  createObject(input: CreateApiObjectInput): Promise<ApiNexusObject> {
    return request<ApiNexusObject>('/api/v1/objects', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  updateObject(id: string, input: UpdateApiObjectInput): Promise<ApiNexusObject> {
    return request<ApiNexusObject>(`/api/v1/objects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  deleteObject(id: string): Promise<void> {
    return request<void>(`/api/v1/objects/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  listDependencies(workspaceId: string, signal?: AbortSignal): Promise<ApiDependencyListResponse> {
    const query = new URLSearchParams({ workspaceId });
    return request<ApiDependencyListResponse>(`/api/v1/dependencies?${query.toString()}`, { signal });
  },

  createDependency(input: CreateApiDependencyInput): Promise<ApiDependency> {
    return request<ApiDependency>('/api/v1/dependencies', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  updateDependency(id: string, input: UpdateApiDependencyInput): Promise<ApiDependency> {
    return request<ApiDependency>(`/api/v1/dependencies/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  deleteDependency(id: string): Promise<void> {
    return request<void>(`/api/v1/dependencies/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  scheduleAnalysis(projectId: string, signal?: AbortSignal): Promise<ApiScheduleAnalysis> {
    const query = new URLSearchParams({ projectId });
    return request<ApiScheduleAnalysis>(`/api/v1/schedule-analysis?${query.toString()}`, { signal });
  },

  saveProjectBaseline(projectId: string, overwrite = false): Promise<ApiBaselineSummary> {
    return request<ApiBaselineSummary>(`/api/v1/projects/${encodeURIComponent(projectId)}/baseline`, {
      method: 'POST',
      body: JSON.stringify({ overwrite }),
    });
  },
};
