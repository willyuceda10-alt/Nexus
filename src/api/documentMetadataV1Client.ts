import { request } from './client';
import type {
  ApiDocumentVersionsResponseV1,
  ApiDocumentWorkspaceSummaryV1,
} from './documentMetadataV1Contracts';

export const documentMetadataV1Api = {
  listWorkspace(workspaceId: string): Promise<ApiDocumentWorkspaceSummaryV1> {
    const query = new URLSearchParams({ workspaceId });
    return request<ApiDocumentWorkspaceSummaryV1>(`/api/v1/document-metadata-v1?${query.toString()}`);
  },

  listVersions(objectId: string): Promise<ApiDocumentVersionsResponseV1> {
    return request<ApiDocumentVersionsResponseV1>(
      `/api/v1/document-metadata-v1/${encodeURIComponent(objectId)}/versions`,
    );
  },
};
