export interface ApiDocumentUploaderV1 {
  id: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
}

export interface ApiDocumentVersionV1 {
  id: string;
  objectId: string;
  fileName: string;
  fileSize: string;
  mimeType: string;
  checksumSha256: string | null;
  checksumVerified: boolean;
  versionNumber: number;
  uploadedByUserId: string | null;
  previousAttachmentId: string | null;
  createdAt: string;
  uploadedBy: ApiDocumentUploaderV1 | null;
}

export interface ApiDocumentSummaryV1 {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  status: string;
  updatedAt: string;
  versionCount: number;
  latestVersion: ApiDocumentVersionV1 | null;
}

export interface ApiDocumentWorkspaceSummaryV1 {
  kind: 'ok';
  workspaceId: string;
  items: ApiDocumentSummaryV1[];
}

export interface ApiDocumentVersionsResponseV1 {
  kind: 'ok';
  objectId: string;
  title: string;
  items: ApiDocumentVersionV1[];
}
