import { request, requestRaw } from './client';
import type { ApiDocumentVersionV1 } from './documentMetadataV1Contracts';

export const documentBinaryV1Api = {
  uploadVersion(objectId: string, file: File): Promise<ApiDocumentVersionV1> {
    const body = new FormData();
    body.append('file', file, file.name);
    return request<ApiDocumentVersionV1>(
      `/api/v1/document-binary-v1/${encodeURIComponent(objectId)}/versions`,
      { method: 'POST', body },
    );
  },

  async downloadAttachment(attachmentId: string): Promise<Blob> {
    const response = await requestRaw(
      `/api/v1/document-binary-v1/${encodeURIComponent(attachmentId)}/download`,
      { method: 'GET' },
    );
    return response.blob();
  },
};
