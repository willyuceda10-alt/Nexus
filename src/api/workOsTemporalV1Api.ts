import { runtimeConfig } from '../config/runtime';
import type { ApiBoardTemporalConfigV1, ApiBoardTemporalDataV1 } from './workOsTemporalV1Contracts';

async function request<T>(tenantId: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  headers.set('x-correlation-id', crypto.randomUUID());
  headers.set('x-bridata-tenant-id', tenantId);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`${runtimeConfig.apiBaseUrl}${path}`, { ...init, headers });
  if (!response.ok) {
    let message = response.statusText || 'No se pudo completar la operación temporal.';
    try {
      const payload = await response.json() as { message?: string; error?: string };
      message = payload.message ?? payload.error ?? message;
    } catch { /* keep transport error */ }
    throw new Error(message);
  }
  return response.status === 204 ? undefined as T : await response.json() as T;
}

export const workOsTemporalV1Api = {
  createView(tenantId: string, boardId: string, input: {
    name: string;
    viewType: 'CALENDAR' | 'TIMELINE';
    config: ApiBoardTemporalConfigV1;
  }): Promise<{ id: string; name: string; view_type: 'CALENDAR' | 'TIMELINE'; config: Record<string, unknown> }> {
    return request(tenantId, `/api/v1/work-os/boards-v1/${encodeURIComponent(boardId)}/temporal-views`, {
      method: 'POST', body: JSON.stringify(input),
    });
  },

  updateConfig(tenantId: string, boardId: string, viewId: string, config: ApiBoardTemporalConfigV1): Promise<{ id: string; temporal: ApiBoardTemporalConfigV1 }> {
    return request(tenantId, `/api/v1/work-os/boards-v1/${encodeURIComponent(boardId)}/views/${encodeURIComponent(viewId)}/temporal-config`, {
      method: 'PUT', body: JSON.stringify(config),
    });
  },

  data(tenantId: string, boardId: string, viewId: string, from: string, to: string): Promise<ApiBoardTemporalDataV1> {
    const query = new URLSearchParams({ viewId, from, to });
    return request(tenantId, `/api/v1/work-os/boards-v1/${encodeURIComponent(boardId)}/temporal-data?${query.toString()}`);
  },
};
