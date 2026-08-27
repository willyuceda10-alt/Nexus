import { runtimeConfig } from '../config/runtime';

export interface ScheduleMeetingV2Input {
  workspaceId: string;
  projectId?: string | null;
  title: string;
  description?: string | null;
  startAt: string;
  endAt: string;
  timezone?: string;
  location?: string | null;
  isOnline?: boolean;
  attendeeUserIds?: string[];
  externalAttendees?: Array<{ email: string; displayName: string; attendeeType?: 'REQUIRED' | 'OPTIONAL' }>;
  resourceIds?: string[];
  requestM365Sync?: boolean;
  validateAvailability?: boolean;
}

export interface ScheduleMeetingV2Result {
  collaborationId: string;
  meetingObjectId: string;
  version: number;
  syncStatus: 'LOCAL_ONLY' | 'PENDING';
  room: { id: string; name: string; capacity: number | null } | null;
  resources: Array<{ id: string; name: string; resourceType: 'ROOM' | 'EQUIPMENT' }>;
}

async function request<T>(tenantId: string, path: string, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  headers.set('content-type', 'application/json');
  headers.set('x-correlation-id', crypto.randomUUID());
  headers.set('x-bridata-tenant-id', tenantId);
  const response = await fetch(`${runtimeConfig.apiBaseUrl}${path}`, { ...init, headers });
  if (!response.ok) {
    let message = response.statusText || 'No se pudo programar la reunión.';
    try {
      const payload = await response.json() as { message?: string; error?: string; peopleCount?: number; room?: { name?: string; capacity?: number } };
      if (payload.error === 'room_capacity_exceeded' && payload.room) {
        message = `La sala ${payload.room.name ?? ''} admite ${payload.room.capacity ?? 0} personas y la reunión requiere ${payload.peopleCount ?? 0}.`;
      } else if (payload.error === 'meeting_slot_conflict') {
        message = 'El horario seleccionado tiene conflictos de personas, sala o equipamiento. Busca otra franja.';
      } else {
        message = payload.message ?? payload.error ?? message;
      }
    } catch { /* keep transport message */ }
    throw new Error(message);
  }
  return await response.json() as T;
}

export const meetingSchedulingV2Api = {
  schedule(tenantId: string, input: ScheduleMeetingV2Input): Promise<ScheduleMeetingV2Result> {
    return request(tenantId, '/api/v1/meetings-v2/schedule', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
};
