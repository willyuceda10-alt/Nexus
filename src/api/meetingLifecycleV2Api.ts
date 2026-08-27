import { runtimeConfig } from '../config/runtime';
import type {
  ApiMeetingLifecycleItemV2,
  CancelMeetingV2Input,
  RescheduleMeetingV2Input,
} from './meetingLifecycleV2Contracts';

async function request<T>(tenantId: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  headers.set('x-correlation-id', crypto.randomUUID());
  headers.set('x-bridata-tenant-id', tenantId);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`${runtimeConfig.apiBaseUrl}${path}`, { ...init, headers });
  if (!response.ok) {
    let message = response.statusText || 'No se pudo completar la operación del ciclo de vida de reunión.';
    try {
      const payload = await response.json() as { message?: string; error?: string };
      message = payload.message ?? payload.error ?? message;
    } catch { /* keep transport error */ }
    throw new Error(message);
  }
  return response.status === 204 ? undefined as T : await response.json() as T;
}

export const meetingLifecycleV2Api = {
  list(tenantId: string, workspaceId: string, projectId?: string): Promise<{ items: ApiMeetingLifecycleItemV2[] }> {
    const query = new URLSearchParams({ workspaceId });
    if (projectId) query.set('projectId', projectId);
    return request(tenantId, `/api/v1/meetings-v2/lifecycle?${query.toString()}`);
  },
  reschedule(
    tenantId: string,
    meetingObjectId: string,
    input: RescheduleMeetingV2Input,
  ): Promise<{ meetingObjectId: string; version: number; syncStatus: string }> {
    return request(tenantId, `/api/v1/meetings-v2/${encodeURIComponent(meetingObjectId)}/reschedule`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },
  cancel(
    tenantId: string,
    meetingObjectId: string,
    input: CancelMeetingV2Input,
  ): Promise<{ meetingObjectId?: string; version?: number; lifecycleStatus: string; syncStatus: string; resourcesReleased?: boolean }> {
    return request(tenantId, `/api/v1/meetings-v2/${encodeURIComponent(meetingObjectId)}/cancel`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  retryCancel(tenantId: string, meetingObjectId: string): Promise<{ lifecycleStatus: string; syncStatus: string }> {
    return request(tenantId, `/api/v1/meetings-v2/${encodeURIComponent(meetingObjectId)}/retry-cancel`, { method: 'POST' });
  },
};
