import { runtimeConfig } from '../config/runtime';
import type { ApiWorkBoardColumnV1 } from './workOsBoardV1Contracts';

export interface BoardPersonV1 {
  id: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  workspaceRole: string;
}

export interface BoardOptionV1 {
  id?: string;
  key: string;
  label: string;
  color: string | null;
  sortOrder: number;
  isActive?: boolean;
}

export interface BoardOptionSetV1 {
  id: string;
  columnId: string;
  name: string;
  allowMultiple: boolean;
  options: BoardOptionV1[];
}

export interface BoardConfigV1 {
  boardId: string;
  workspaceId: string;
  people: BoardPersonV1[];
  boards: Array<{ id: string; name: string; objectDefinitionId: string }>;
  optionSets: BoardOptionSetV1[];
}

export type BoardFormulaExpressionV1 =
  | { kind: 'FIELD'; fieldKey: string }
  | { kind: 'LITERAL'; value: number }
  | {
      kind: 'BINARY';
      op: 'ADD' | 'SUBTRACT' | 'MULTIPLY' | 'DIVIDE' | 'MIN' | 'MAX';
      left: BoardFormulaExpressionV1;
      right: BoardFormulaExpressionV1;
    };

export interface BoardRelationTargetV1 {
  id: string;
  title: string;
  status: string;
  objectTypeKey: string;
}

async function request<T>(tenantId: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  headers.set('x-correlation-id', crypto.randomUUID());
  headers.set('x-bridata-tenant-id', tenantId);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`${runtimeConfig.apiBaseUrl}${path}`, { ...init, headers });
  if (!response.ok) {
    let message = response.statusText || 'No se pudo completar la configuración del tablero.';
    try {
      const payload = await response.json() as { message?: string; error?: string };
      message = payload.message ?? payload.error ?? message;
    } catch {
      // Keep transport message.
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

export const workOsBoardConfigV1Api = {
  configuration(tenantId: string, boardId: string): Promise<BoardConfigV1> {
    return request(tenantId, `/api/v1/work-os/boards-v1/${encodeURIComponent(boardId)}/configuration`);
  },

  replaceOptions(tenantId: string, boardId: string, columnId: string, input: {
    name?: string;
    options: Array<{ key: string; label: string; color?: string | null }>;
  }): Promise<BoardOptionSetV1> {
    return request(tenantId, `/api/v1/work-os/boards-v1/${encodeURIComponent(boardId)}/columns/${encodeURIComponent(columnId)}/options`, {
      method: 'PUT', body: JSON.stringify(input),
    });
  },

  createRelationColumn(tenantId: string, boardId: string, input: {
    label: string;
    fieldKey: string;
    targetBoardId: string;
    multiple: boolean;
  }): Promise<ApiWorkBoardColumnV1> {
    return request(tenantId, `/api/v1/work-os/boards-v1/${encodeURIComponent(boardId)}/relation-columns`, {
      method: 'POST', body: JSON.stringify(input),
    });
  },

  createFormulaColumn(tenantId: string, boardId: string, input: {
    label: string;
    fieldKey: string;
    expression: BoardFormulaExpressionV1;
    format?: 'NUMBER' | 'CURRENCY' | 'PERCENT';
    decimals?: number;
    currency?: string;
  }): Promise<ApiWorkBoardColumnV1> {
    return request(tenantId, `/api/v1/work-os/boards-v1/${encodeURIComponent(boardId)}/formula-columns`, {
      method: 'POST', body: JSON.stringify(input),
    });
  },

  relationCandidates(tenantId: string, boardId: string, columnId: string, search = ''): Promise<{ items: BoardRelationTargetV1[] }> {
    const query = new URLSearchParams({ limit: '100' });
    if (search.trim()) query.set('search', search.trim());
    return request(tenantId, `/api/v1/work-os/boards-v1/${encodeURIComponent(boardId)}/columns/${encodeURIComponent(columnId)}/relation-candidates?${query.toString()}`);
  },

  updateRelationCell(tenantId: string, boardId: string, objectId: string, columnId: string, input: {
    version: number;
    targetObjectIds: string[];
  }): Promise<{ objectId: string; version: number; targetObjectIds: string[] }> {
    return request(tenantId, `/api/v1/work-os/boards-v1/${encodeURIComponent(boardId)}/items/${encodeURIComponent(objectId)}/relations/${encodeURIComponent(columnId)}`, {
      method: 'PUT', body: JSON.stringify(input),
    });
  },

  updatePersonCell(tenantId: string, boardId: string, objectId: string, columnId: string, input: {
    version: number;
    userId: string | null;
  }): Promise<{ objectId: string; version: number; userId: string | null }> {
    return request(tenantId, `/api/v1/work-os/boards-v1/${encodeURIComponent(boardId)}/items/${encodeURIComponent(objectId)}/person-cells/${encodeURIComponent(columnId)}`, {
      method: 'PATCH', body: JSON.stringify(input),
    });
  },

  computedValues(tenantId: string, boardId: string): Promise<{ valuesByObjectId: Record<string, Record<string, unknown>> }> {
    return request(tenantId, `/api/v1/work-os/boards-v1/${encodeURIComponent(boardId)}/computed-values`);
  },
};
