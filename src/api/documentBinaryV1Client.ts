import { request } from './client';
import type { ApiDocumentVersionV1 } from './documentMetadataV1Contracts';

export interface ApiDocumentDownloadLinkV1 {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  checksumSha256: string | null;
  url: string;
  expiresAt: string;
}

export const documentBinaryV1Api = {
  uploadVersion(objectId: string, file: File): Promise<ApiDocumentVersionV1> {
    return request<ApiDocumentVersionV1>(
      `/api/v1/document-binary-v1/${encodeURIComponent(objectId)}/versions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-bridata-file-name': encodeURIComponent(file.name),
          'x-bridata-file-mime-type': file.type || 'application/octet-stream',
        },
        body: file,
      },
    );
  },

  downloadLink(attachmentId: string): Promise<ApiDocumentDownloadLinkV1> {
    return request<ApiDocumentDownloadLinkV1>(
      `/api/v1/document-binary-v1/${encodeURIComponent(attachmentId)}/download-link`,
      { method: 'GET' },
    );
  },
};
