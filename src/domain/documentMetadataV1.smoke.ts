import { mapDocumentCardV1, mapDocumentVersionCardV1 } from './documentMetadataV1';
import type { ApiDocumentSummaryV1, ApiDocumentVersionV1 } from '../api/documentMetadataV1Contracts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const version: ApiDocumentVersionV1 = {
  id: 'version-2',
  objectId: 'document-1',
  fileName: 'memoria-calculo.pdf',
  storageKey: 'documents/tenant/document-1/version-2.pdf',
  fileSize: String(2 * 1024 * 1024),
  mimeType: 'application/pdf',
  checksumSha256: 'a'.repeat(64),
  checksumVerified: true,
  versionNumber: 2,
  uploadedByUserId: 'user-1',
  previousAttachmentId: 'version-1',
  createdAt: '2026-08-29T18:20:00.000Z',
  uploadedBy: {
    id: 'user-1',
    fullName: 'Usuario Prueba',
    email: 'usuario@example.com',
    avatarUrl: null,
  },
};

const summary: ApiDocumentSummaryV1 = {
  id: 'document-1',
  workspaceId: 'workspace-1',
  title: 'Memoria de cálculo',
  description: 'Documento técnico versionado.',
  status: 'IN_REVIEW',
  updatedAt: '2026-08-29T18:20:00.000Z',
  versionCount: 2,
  latestVersion: version,
};

const mappedVersion = mapDocumentVersionCardV1(version);
assert(mappedVersion.versionLabel === 'v2', 'Version label must come from persisted versionNumber.');
assert(mappedVersion.sizeLabel === '2.0 MB', 'File size must be formatted from persisted bytes.');
assert(mappedVersion.checksumVerified, 'Persisted SHA-256 verification flag must be preserved.');
assert(mappedVersion.checksumLabel === 'SHA-256 registrado', 'Checksum label must not claim verification without metadata.');
assert(mappedVersion.uploaderName === 'Usuario Prueba', 'Uploader identity must map from the API.');

const mappedDocument = mapDocumentCardV1(summary);
assert(mappedDocument.versionCount === 2, 'Document version count must be persisted data.');
assert(mappedDocument.latestVersion?.fileName === 'memoria-calculo.pdf', 'Latest persisted file must be surfaced.');

const withoutFile = mapDocumentCardV1({ ...summary, versionCount: 0, latestVersion: null });
assert(withoutFile.latestVersion === null, 'Documents without binary metadata must remain explicitly empty.');

console.info(JSON.stringify({
  documentMetadataV1Frontend: 'PASS',
  persistedVersionLabels: true,
  persistedFileSize: true,
  truthfulChecksumState: true,
  emptyBinaryState: true,
}));
