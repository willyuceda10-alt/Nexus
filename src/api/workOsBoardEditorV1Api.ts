import { runtimeConfig } from '../config/runtime';
import type {
  ApiWorkBoardColumnV1,
  ApiWorkBoardGroupV1,
  ApiWorkViewV1,
} from './workOsBoardV1Contracts';

export interface ApiAvailableBoardItemV1 {
  id: string;
  title: string;
  status: string;
  priority: string;
  progress: number;
  version: number;
  assignee: { id: string; fullName: string; avatarUrl: string | null } | null;
}

async function editorRequest<T>(tenantId: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  headers.set('x-correlation-id', crypto.randomUUID());
  headers.set('x-bridata-tenant-id', tenantId);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`${runtimeConfig.apiBaseUrl}${path}`, { ...init, headers });
  if (!response.ok) {
    let message = response.statusText || 'No se pudo completar la operación del tablero.';
    let code = 'request_error';
    try {
      const payload = await response.json() as { error?: string; message?: string };
      code = payload.error ?? code;
      message = payload.message ?? message;
    } catch {
      // Keep transport message.
    }
    const error = new Error(message) as Error & { status?: number; code?: string };
    error.status = response.status;
    error.code = code;
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

export const workOsBoardEditorV1Api = {
  availableItems(tenantId: string, boardId: string, search = ''): Promise<{ items: ApiAvailableBoardItemV1[] }> {
    const query = new URLSearchParams({ limit: '100' });
    if (search.trim()) query.set('search', search.trim());
    return editorRequest(tenantId, `/api/v1/work-os/boards-v1/${encodeURIComponent(boardId)}/available-items?${query.toString()}`);
  },

  updateColumn(tenantId: string, boardId: string, columnId: string, input: {
    label?: string;
    width?: number | null;
    sortOrder?: number;
    isVisible?: boolean;
    isEditable?: boolean;
    config?: Record<string, unknown> | null;
  }): Promise<ApiWorkBoardColumnV1> {
    return editorRequest(tenantId, `/api/v1/work-os/boards-v1/${encodeURIComponent(boardId)}/columns/${encodeURIComponent(columnId)}`, {
      method: 'PATCH', body: JSON.stringify(input),
    });
  },

  updateView(tenantId: string, boardId: string, viewId: string, input: {
    name?: string;
    isDefault?: boolean;
    sortOrder?: number;
    config?: Record<string, unknown>;
  }): Promise<ApiWorkViewV1> {
    return editorRequest(tenantId, `/api/v1/work-os/boards-v1/${encodeURIComponent(boardId)}/views/${encodeURIComponent(viewId)}`, {
      method: 'PATCH', body: JSON.stringify(input),
    });
  },

  updateGroup(tenantId: string, boardId: string, groupId: string, input: {
    name?: string;
    color?: string | null;
    sortOrder?: number;
  }): Promise<ApiWorkBoardGroupV1> {
    return editorRequest(tenantId, `/api/v1/work-os/boards-v1/${encodeURIComponent(boardId)}/groups/${encodeURIComponent(groupId)}`, {
      method: 'PATCH', body: JSON.stringify(input),
    });
  },

  updateCell(tenantId: string, boardId: string, objectId: string, columnId: string, input: {
    version: number;
    value: unknown;
  }): Promise<{ objectId: string; version: number }> {
    return editorRequest(tenantId, `/api/v1/work-os/boards-v1/${encodeURIComponent(boardId)}/items/${encodeURIComponent(objectId)}/cells/${encodeURIComponent(columnId)}`, {
      method: 'PATCH', body: JSON.stringify(input),
    });
  },

  savePlacements(tenantId: string, boardId: string, items: Array<{ objectId: string; groupId: string | null; sortOrder: number }>): Promise<void> {
    return editorRequest(tenantId, `/api/v1/work-os/boards-v1/${encodeURIComponent(boardId)}/placements`, {
      method: 'PUT', body: JSON.stringify({ items }),
    });
  },

  removeItem(tenantId: string, boardId: string, objectId: string): Promise<void> {
    return editorRequest(tenantId, `/api/v1/work-os/boards-v1/${encodeURIComponent(boardId)}/items/${encodeURIComponent(objectId)}`, {
      method: 'DELETE',
    });
  },
};
