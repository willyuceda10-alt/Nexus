import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { withTenant } from '../src/tenant-transaction.js';

const DEV_TENANT_ID = '00000000-0000-4000-8000-000000000002';
const DEV_WORKSPACE_ID = '00000000-0000-4000-8000-000000000003';
const DEV_USER_ID = '00000000-0000-4000-8000-000000000001';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const app = await buildApp();
  let documentId: string | null = null;

  try {
    const bootstrapResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'x-correlation-id': 'ci-document-metadata-bootstrap' },
    });
    assert(bootstrapResponse.statusCode === 200, `Bootstrap returned ${bootstrapResponse.statusCode}: ${bootstrapResponse.body}`);
    const bootstrap = bootstrapResponse.json() as { objectDefinitions?: Array<{ id: string; key: string }> };
    const definition = bootstrap.objectDefinitions?.find((item) => item.key === 'DOCUMENT');
    assert(definition, 'DOCUMENT definition is required for document metadata smoke.');

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/objects',
      headers: { 'x-correlation-id': 'ci-document-metadata-create' },
      payload: {
        workspaceId: DEV_WORKSPACE_ID,
        objectDefinitionId: definition.id,
        objectTypeKey: 'DOCUMENT',
        title: 'CI document metadata',
        description: 'Temporary document for version metadata verification.',
        status: 'DRAFT',
        priority: 'MEDIUM',
        progress: 0,
      },
    });
    assert(createResponse.statusCode === 201, `Document create returned ${createResponse.statusCode}: ${createResponse.body}`);
    const created = createResponse.json() as { id: string };
    documentId = created.id;

    const checksumV1 = '1'.repeat(64);
    const checksumV2 = '2'.repeat(64);

    await withTenant(DEV_TENANT_ID, async (tx) => {
      const first = await tx.objectAttachment.create({
        data: {
          tenantId: DEV_TENANT_ID,
          objectId: created.id,
          fileName: 'documento-v1.pdf',
          storageKey: `documents/${DEV_TENANT_ID}/${created.id}/v1/documento.pdf`,
          fileSize: BigInt(1024),
          mimeType: 'application/pdf',
          checksumSha256: checksumV1,
          versionNumber: 1,
          uploadedByUserId: DEV_USER_ID,
        },
      });
      await tx.objectAttachment.create({
        data: {
          tenantId: DEV_TENANT_ID,
          objectId: created.id,
          fileName: 'documento-v2.pdf',
          storageKey: `documents/${DEV_TENANT_ID}/${created.id}/v2/documento.pdf`,
          fileSize: BigInt(2048),
          mimeType: 'application/pdf',
          checksumSha256: checksumV2,
          versionNumber: 2,
          uploadedByUserId: DEV_USER_ID,
          previousAttachmentId: first.id,
        },
      });
    });

    const workspaceResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/document-metadata-v1?workspaceId=${DEV_WORKSPACE_ID}`,
      headers: { 'x-correlation-id': 'ci-document-metadata-workspace' },
    });
    assert(workspaceResponse.statusCode === 200, `Workspace metadata returned ${workspaceResponse.statusCode}: ${workspaceResponse.body}`);
    const workspace = workspaceResponse.json() as {
      items: Array<{
        id: string;
        versionCount: number;
        latestVersion: null | {
          versionNumber: number;
          fileName: string;
          fileSize: string;
          checksumVerified: boolean;
          uploadedBy: { id: string } | null;
        };
      }>;
    };
    const item = workspace.items.find((candidate) => candidate.id === created.id);
    assert(item, 'Document summary was not returned.');
    assert(item.versionCount === 2, 'Document summary must expose both persisted versions.');
    assert(item.latestVersion?.versionNumber === 2, 'Latest version must be the highest persisted version.');
    assert(item.latestVersion.fileName === 'documento-v2.pdf', 'Latest version filename mismatch.');
    assert(item.latestVersion.fileSize === '2048', 'BigInt file size must serialize losslessly.');
    assert(item.latestVersion.checksumVerified, 'Valid SHA-256 metadata must be identified.');
    assert(item.latestVersion.uploadedBy?.id === DEV_USER_ID, 'Uploader identity was not resolved.');

    const versionsResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/document-metadata-v1/${created.id}/versions`,
      headers: { 'x-correlation-id': 'ci-document-metadata-versions' },
    });
    assert(versionsResponse.statusCode === 200, `Versions returned ${versionsResponse.statusCode}: ${versionsResponse.body}`);
    const versions = versionsResponse.json() as { items: Array<{ versionNumber: number; previousAttachmentId: string | null }> };
    assert(versions.items.length === 2, 'Version endpoint must return both attachment versions.');
    assert(versions.items[0]?.versionNumber === 2 && versions.items[1]?.versionNumber === 1, 'Versions must be ordered newest first.');
    assert(Boolean(versions.items[0]?.previousAttachmentId), 'V2 must retain lineage to the previous attachment.');

    console.info(JSON.stringify({
      documentMetadataV1: 'PASS',
      persistentVersions: true,
      latestVersionProjection: true,
      losslessFileSize: true,
      sha256Metadata: true,
      uploaderResolution: true,
      versionLineage: true,
    }));
  } finally {
    if (documentId) {
      const cleanup = await app.inject({
        method: 'DELETE',
        url: `/api/v1/objects/${documentId}`,
        headers: { 'x-correlation-id': 'ci-document-metadata-cleanup' },
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
