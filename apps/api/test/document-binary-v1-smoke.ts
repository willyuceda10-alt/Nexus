import { createHash } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { MemoryDocumentBinaryStoreV1 } from '../src/document-binary-store-v1.js';
import { prisma } from '../src/db.js';

const DEV_WORKSPACE_ID = '00000000-0000-4000-8000-000000000003';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function uploadHeaders(fileName: string, mimeType: string, correlationId: string) {
  return {
    'content-type': 'application/octet-stream',
    'x-bridata-file-name': encodeURIComponent(fileName),
    'x-bridata-file-mime-type': mimeType,
    'x-correlation-id': correlationId,
  };
}

async function main() {
  const store = new MemoryDocumentBinaryStoreV1();
  const app = await buildApp({ documentBinaryStore: store });
  let objectId: string | null = null;

  try {
    const bootstrapResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'x-correlation-id': 'ci-document-binary-bootstrap' },
    });
    assert(bootstrapResponse.statusCode === 200, `Bootstrap failed: ${bootstrapResponse.body}`);
    const bootstrap = bootstrapResponse.json() as {
      objectDefinitions?: Array<{ id: string; key: string }>;
    };
    const documentDefinition = bootstrap.objectDefinitions?.find((item) => item.key === 'DOCUMENT');
    assert(documentDefinition, 'DOCUMENT definition is required.');

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/objects',
      headers: { 'x-correlation-id': 'ci-document-binary-create' },
      payload: {
        workspaceId: DEV_WORKSPACE_ID,
        objectDefinitionId: documentDefinition.id,
        objectTypeKey: 'DOCUMENT',
        title: 'CI binary document',
        description: 'Temporary document for binary storage smoke.',
        status: 'DRAFT',
        priority: 'MEDIUM',
        progress: 0,
      },
    });
    assert(createResponse.statusCode === 201, `Create failed: ${createResponse.body}`);
    objectId = (createResponse.json() as { id: string }).id;

    const v1Content = Buffer.from('%PDF-1.7\nBridata document binary V1');
    const uploadV1 = await app.inject({
      method: 'POST',
      url: `/api/v1/document-binary-v1/${objectId}/versions`,
      headers: uploadHeaders('specification.pdf', 'application/pdf', 'ci-document-binary-upload-v1'),
      payload: v1Content,
    });
    assert(uploadV1.statusCode === 201, `Upload V1 failed: ${uploadV1.body}`);
    const version1 = uploadV1.json() as {
      id: string;
      versionNumber: number;
      checksumSha256: string;
      previousAttachmentId: string | null;
    };
    assert(version1.versionNumber === 1, 'First binary must be version 1.');
    assert(version1.previousAttachmentId === null, 'First binary must not have a previous attachment.');
    assert(
      version1.checksumSha256 === createHash('sha256').update(v1Content).digest('hex'),
      'V1 SHA-256 must be calculated from uploaded bytes.',
    );

    const v2Content = Buffer.from('%PDF-1.7\nBridata document binary V2 with revision');
    const uploadV2 = await app.inject({
      method: 'POST',
      url: `/api/v1/document-binary-v1/${objectId}/versions`,
      headers: uploadHeaders('specification.pdf', 'application/pdf', 'ci-document-binary-upload-v2'),
      payload: v2Content,
    });
    assert(uploadV2.statusCode === 201, `Upload V2 failed: ${uploadV2.body}`);
    const version2 = uploadV2.json() as {
      id: string;
      versionNumber: number;
      previousAttachmentId: string | null;
      fileSize: string;
    };
    assert(version2.versionNumber === 2, 'Second binary must be version 2.');
    assert(version2.previousAttachmentId === version1.id, 'V2 must link to V1.');
    assert(version2.fileSize === String(v2Content.byteLength), 'V2 must persist exact byte size.');

    const versionsResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/document-metadata-v1/${objectId}/versions`,
      headers: { 'x-correlation-id': 'ci-document-binary-list' },
    });
    assert(versionsResponse.statusCode === 200, `Version list failed: ${versionsResponse.body}`);
    const versions = versionsResponse.json() as {
      items: Array<Record<string, unknown> & { id: string; versionNumber: number; previousAttachmentId: string | null }>;
    };
    assert(versions.items.length === 2, 'Document must expose exactly two persistent binary versions.');
    assert(versions.items[0]?.id === version2.id && versions.items[0]?.versionNumber === 2, 'Latest version must be V2.');
    assert(!('storageKey' in versions.items[0]!), 'Internal Blob storageKey must not be exposed to the web client.');

    const download = await app.inject({
      method: 'GET',
      url: `/api/v1/document-binary-v1/${version2.id}/download`,
      headers: { 'x-correlation-id': 'ci-document-binary-download' },
    });
    assert(download.statusCode === 200, `Download failed: ${download.body}`);
    assert(download.rawPayload.equals(v2Content), 'Downloaded binary must equal uploaded V2 bytes.');
    assert(download.headers['content-type']?.startsWith('application/pdf'), 'Download must preserve MIME type.');
    assert(download.headers['content-disposition']?.includes('specification.pdf'), 'Download must preserve safe file name.');

    const blocked = await app.inject({
      method: 'POST',
      url: `/api/v1/document-binary-v1/${objectId}/versions`,
      headers: uploadHeaders('malware.exe', 'application/octet-stream', 'ci-document-binary-blocked-type'),
      payload: Buffer.from('MZ'),
    });
    assert(blocked.statusCode === 415, `Executable upload must be rejected, got ${blocked.statusCode}.`);

    const collaboration = await app.inject({
      method: 'GET',
      url: `/api/v1/objects/${objectId}/collaboration-v1?commentLimit=5&auditLimit=50&historyLimit=5`,
      headers: { 'x-correlation-id': 'ci-document-binary-audit' },
    });
    assert(collaboration.statusCode === 200, `Collaboration audit failed: ${collaboration.body}`);
    const auditPayload = collaboration.json() as { audit: Array<{ action: string }> };
    assert(
      auditPayload.audit.some((entry) => entry.action === 'DOCUMENT_VERSION_UPLOADED'),
      'Upload audit event is missing.',
    );
    assert(
      auditPayload.audit.some((entry) => entry.action === 'DOCUMENT_VERSION_DOWNLOADED'),
      'Download audit event is missing.',
    );

    console.info(JSON.stringify({
      documentBinaryV1: 'PASS',
      realBinaryRoundTrip: true,
      sha256FromBytes: true,
      persistentVersionLineage: true,
      storageKeyHidden: true,
      executableBlock: true,
      downloadAudit: true,
      memoryOnlyTestStore: true,
    }));
  } finally {
    if (objectId) {
      const cleanup = await app.inject({
        method: 'DELETE',
        url: `/api/v1/objects/${objectId}`,
        headers: { 'x-correlation-id': 'ci-document-binary-cleanup' },
      });
      if (cleanup.statusCode !== 204 && cleanup.statusCode !== 404) {
        console.error(`Cleanup returned ${cleanup.statusCode}: ${cleanup.body}`);
      }
    }
    await app.close();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
