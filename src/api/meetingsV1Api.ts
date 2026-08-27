import { runtimeConfig } from '../config/runtime';
import type {
  ApiMeetingCapabilitiesV1,
  ApiMeetingV1,
  CreateApiMeetingV1Input,
  UpdateApiMeetingV1Input,
} from './meetingsV1Contracts';

async function request<T>(tenantId: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  headers.set('x-correlation-id', crypto.randomUUID());
  headers.set('x-bridata-tenant-id', tenantId);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`${runtimeConfig.apiBaseUrl}${path}`, { ...init, headers });
  if (!response.ok) {
    let message = response.statusText || 'No se pudo completar la operación de reunión.';
    try {
      const payload = await response.json() as { message?: string; error?: string };
      message = payload.message ?? payload.error ?? message;
    } catch { /* keep transport error */ }
    throw new Error(message);
  }
  return response.status === 204 ? undefined as T : await response.json() as T;
}

export const meetingsV1Api = {
  capabilities(tenantId: string): Promise<ApiMeetingCapabilitiesV1> {
    return request(tenantId, '/api/v1/meetings-v1/capabilities');
  },
  list(tenantId: string, input: { workspaceId: string; projectId?: string; from?: string; to?: string; limit?: number }): Promise<{ items: ApiMeetingV1[] }> {
    const query = new URLSearchParams({ workspaceId: input.workspaceId });
    if (input.projectId) query.set('projectId', input.projectId);
    if (input.from) query.set('from', input.from);
    if (input.to) query.set('to', input.to);
    if (input.limit) query.set('limit', String(input.limit));
    return request(tenantId, `/api/v1/meetings-v1?${query.toString()}`);
  },
  create(tenantId: string, input: CreateApiMeetingV1Input): Promise<{ collaborationId: string; meetingObjectId: string; version: number; syncStatus: string }> {
    return request(tenantId, '/api/v1/meetings-v1', { method: 'POST', body: JSON.stringify(input) });
  },
  update(tenantId: string, meetingObjectId: string, input: UpdateApiMeetingV1Input): Promise<{ meetingObjectId: string; version: number; syncStatus: string }> {
    return request(tenantId, `/api/v1/meetings-v1/${encodeURIComponent(meetingObjectId)}`, { method: 'PUT', body: JSON.stringify(input) });
  },
  retrySync(tenantId: string, meetingObjectId: string): Promise<{ syncStatus: 'PENDING' }> {
    return request(tenantId, `/api/v1/meetings-v1/${encodeURIComponent(meetingObjectId)}/retry-sync`, { method: 'POST' });
  },
};
