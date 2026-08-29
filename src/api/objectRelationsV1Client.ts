import { request } from './client';
import type {
  ApiObjectRelationListV1,
  ApiObjectRelationV1,
  CreateApiObjectRelationV1Input,
} from './objectRelationsV1Contracts';

export const objectRelationsV1Api = {
  list(workspaceId: string, signal?: AbortSignal): Promise<ApiObjectRelationListV1> {
    const query = new URLSearchParams({ workspaceId });
    return request<ApiObjectRelationListV1>(`/api/v1/object-relations-v1?${query.toString()}`, { signal });
  },

  create(input: CreateApiObjectRelationV1Input): Promise<ApiObjectRelationV1> {
    return request<ApiObjectRelationV1>('/api/v1/object-relations-v1', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  delete(id: string): Promise<void> {
    return request<void>(`/api/v1/object-relations-v1/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
};
