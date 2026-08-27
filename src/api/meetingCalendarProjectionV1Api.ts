import { runtimeConfig } from '../config/runtime';
import type { ApiMeetingCalendarProjectionV1 } from './meetingCalendarProjectionV1Contracts';

async function request<T>(tenantId: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  headers.set('x-correlation-id', crypto.randomUUID());
  headers.set('x-bridata-tenant-id', tenantId);
  const response = await fetch(`${runtimeConfig.apiBaseUrl}${path}`, { ...init, headers });
  if (!response.ok) {
    let message = response.statusText || 'No se pudo cargar la proyección de calendario.';
    try {
      const payload = await response.json() as { message?: string; error?: string };
      message = payload.message ?? payload.error ?? message;
    } catch { /* keep transport error */ }
    throw new Error(message);
  }
  return await response.json() as T;
}

export const meetingCalendarProjectionV1Api = {
  list(
    tenantId: string,
    input: { workspaceId: string; projectId?: string; startAt: string; endAt: string },
  ): Promise<ApiMeetingCalendarProjectionV1> {
    const query = new URLSearchParams({
      workspaceId: input.workspaceId,
      startAt: input.startAt,
      endAt: input.endAt,
    });
    if (input.projectId) query.set('projectId', input.projectId);
    return request(tenantId, `/api/v1/meetings-v3/calendar-projection?${query.toString()}`);
  },
};
