import { runtimeConfig } from '../config/runtime';
import type {
  ApiMeetingResourceAvailabilityV1,
  ApiMeetingResourceV1,
  CreateApiMeetingResourceV1Input,
} from './meetingResourcesV1Contracts';

async function request<T>(tenantId: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  headers.set('x-correlation-id', crypto.randomUUID());
  headers.set('x-bridata-tenant-id', tenantId);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`${runtimeConfig.apiBaseUrl}${path}`, { ...init, headers });
  if (!response.ok) {
    let message = response.statusText || 'No se pudo completar la operación de recurso de reunión.';
    try {
      const payload = await response.json() as { message?: string; error?: string };
      message = payload.message ?? payload.error ?? message;
    } catch { /* keep transport error */ }
    throw new Error(message);
  }
  return response.status === 204 ? undefined as T : await response.json() as T;
}

export const meetingResourcesV1Api = {
  list(tenantId: string, workspaceId: string, includeInactive = false): Promise<{ items: ApiMeetingResourceV1[] }> {
    const query = new URLSearchParams({ workspaceId, includeInactive: String(includeInactive) });
    return request(tenantId, `/api/v1/meetings-v1/resources?${query.toString()}`);
  },
  create(tenantId: string, input: CreateApiMeetingResourceV1Input): Promise<ApiMeetingResourceV1> {
    return request(tenantId, '/api/v1/meetings-v1/resources', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  update(
    tenantId: string,
    resourceId: string,
    input: Partial<Omit<CreateApiMeetingResourceV1Input, 'workspaceId'>>,
  ): Promise<ApiMeetingResourceV1> {
    return request(tenantId, `/api/v1/meetings-v1/resources/${encodeURIComponent(resourceId)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },
  forMeeting(tenantId: string, meetingObjectId: string): Promise<{ items: ApiMeetingResourceV1[] }> {
    return request(tenantId, `/api/v1/meetings-v1/${encodeURIComponent(meetingObjectId)}/resources`);
  },
  replaceBooking(
    tenantId: string,
    meetingObjectId: string,
    input: { resourceIds: string[]; requestM365Sync?: boolean },
  ): Promise<{ items: ApiMeetingResourceV1[]; syncRequested: boolean; syncDeferred: boolean }> {
    return request(tenantId, `/api/v1/meetings-v1/${encodeURIComponent(meetingObjectId)}/resources`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },
  availability(
    tenantId: string,
    input: {
      workspaceId: string;
      attendeeUserIds: string[];
      resourceIds: string[];
      includeOrganizer?: boolean;
      startAt: string;
      endAt: string;
      intervalMinutes?: number;
      durationMinutes?: number;
    },
  ): Promise<ApiMeetingResourceAvailabilityV1> {
    return request(tenantId, '/api/v1/meetings-v1/availability-v2', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
};
