import { runtimeConfig } from '../config/runtime';
import type { ApiRecurringMeetingSeriesV1, CreateRecurringMeetingV1Input } from './recurringMeetingsV1Contracts';

async function request<T>(tenantId: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  headers.set('x-correlation-id', crypto.randomUUID());
  headers.set('x-bridata-tenant-id', tenantId);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`${runtimeConfig.apiBaseUrl}${path}`, { ...init, headers });
  if (!response.ok) {
    let message = response.statusText || 'No se pudo completar la operación recurrente.';
    try {
      const payload = await response.json() as { message?: string; error?: string };
      message = payload.message ?? payload.error ?? message;
    } catch { /* keep transport error */ }
    throw new Error(message);
  }
  return response.status === 204 ? undefined as T : await response.json() as T;
}

export const recurringMeetingsV1Api = {
  list(tenantId: string, workspaceId: string, projectId?: string): Promise<{ items: ApiRecurringMeetingSeriesV1[] }> {
    const query = new URLSearchParams({ workspaceId });
    if (projectId) query.set('projectId', projectId);
    return request(tenantId, `/api/v1/meetings-v3/recurring?${query.toString()}`);
  },
  create(tenantId: string, input: CreateRecurringMeetingV1Input): Promise<{ seriesId: string; masterMeetingObjectId: string; collaborationId: string; occurrenceCount: number; version: number; syncStatus: string }> {
    return request(tenantId, '/api/v1/meetings-v3/recurring', { method: 'POST', body: JSON.stringify(input) });
  },
  rescheduleSeries(tenantId: string, seriesId: string, input: { version: number; startAt: string; endAt: string; location?: string | null; requestM365Sync?: boolean }): Promise<{ seriesId: string; masterMeetingObjectId: string; version: number; syncStatus: string }> {
    return request(tenantId, `/api/v1/meetings-v3/recurring/${encodeURIComponent(seriesId)}/reschedule`, { method: 'PUT', body: JSON.stringify(input) });
  },
  rescheduleOccurrence(tenantId: string, seriesId: string, occurrenceId: string, input: { version: number; startAt: string; endAt: string; location?: string | null; requestM365Sync?: boolean }): Promise<{ seriesId: string; occurrenceId: string; version: number; lifecycleStatus: string; syncRequested: boolean }> {
    return request(tenantId, `/api/v1/meetings-v3/recurring/${encodeURIComponent(seriesId)}/occurrences/${encodeURIComponent(occurrenceId)}`, { method: 'PUT', body: JSON.stringify(input) });
  },
  cancelOccurrence(tenantId: string, seriesId: string, occurrenceId: string, input: { version: number; comment?: string | null }): Promise<{ seriesId: string; occurrenceId: string; version?: number; lifecycleStatus: string }> {
    return request(tenantId, `/api/v1/meetings-v3/recurring/${encodeURIComponent(seriesId)}/occurrences/${encodeURIComponent(occurrenceId)}/cancel`, { method: 'POST', body: JSON.stringify(input) });
  },
  cancelSeries(tenantId: string, seriesId: string, input: { version: number; comment?: string | null }): Promise<{ seriesId: string; masterMeetingObjectId?: string; version?: number; lifecycleStatus: string; syncStatus?: string }> {
    return request(tenantId, `/api/v1/meetings-v3/recurring/${encodeURIComponent(seriesId)}/cancel`, { method: 'POST', body: JSON.stringify(input) });
  },
};
