import type { ApiDocumentSummaryV1, ApiDocumentVersionV1 } from '../api/documentMetadataV1Contracts';

export interface DocumentVersionCardV1 {
  id: string;
  versionLabel: string;
  fileName: string;
  mimeType: string;
  sizeLabel: string;
  checksumLabel: string;
  checksumVerified: boolean;
  uploaderName: string | null;
  createdAt: string;
}

export interface DocumentCardV1 {
  id: string;
  title: string;
  description: string;
  status: string;
  versionCount: number;
  latestVersion: DocumentVersionCardV1 | null;
}

export function formatDocumentBytesV1(value: string): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return 'Tamaño desconocido';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function mapDocumentVersionCardV1(value: ApiDocumentVersionV1): DocumentVersionCardV1 {
  const checksumVerified = value.checksumVerified && Boolean(value.checksumSha256);
  return {
    id: value.id,
    versionLabel: `v${value.versionNumber}`,
    fileName: value.fileName,
    mimeType: value.mimeType,
    sizeLabel: formatDocumentBytesV1(value.fileSize),
    checksumLabel: checksumVerified ? 'SHA-256 registrado' : 'SHA-256 no disponible',
    checksumVerified,
    uploaderName: value.uploadedBy?.fullName ?? null,
    createdAt: value.createdAt,
  };
}

export function mapDocumentCardV1(value: ApiDocumentSummaryV1): DocumentCardV1 {
  return {
    id: value.id,
    title: value.title,
    description: value.description ?? '',
    status: value.status,
    versionCount: value.versionCount,
    latestVersion: value.latestVersion ? mapDocumentVersionCardV1(value.latestVersion) : null,
  };
}
