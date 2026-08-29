import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '../src/db.js';
import { buildApp } from '../src/app.js';
import { MemoryIntegrationBinaryStoreV1 } from '../src/integration-binary-store-v1.js';
import { withTenant } from '../src/tenant-transaction.js';

const TENANT_ID = process.env.DEV_TENANT_ID ?? '00000000-0000-4000-8000-000000000002';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const connection = await withTenant(TENANT_ID, (tx) => tx.integrationConnection.create({
    data: {
      tenantId: TENANT_ID,
      provider: 'SAP',
      status: 'ACTIVE',
      displayName: `SAP Foundation Smoke ${Date.now()}`,
      config: { purpose: 'smoke' },
    },
    select: { id: true },
  }));

  const binaryStore = new MemoryIntegrationBinaryStoreV1();
  const app = await buildApp({ integrationBinaryStore: binaryStore });
  const sourceKey = 'SAP_PROCUREMENT_COMMITMENTS';
  const fileBytes = Buffer.from('Bridata SAP integration foundation deterministic smoke payload');
  const expectedChecksum = createHash('sha256').update(fileBytes).digest('hex');

  try {
    const sourceResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/integrations/sap/connections/${connection.id}/sources`,
      payload: {
        sourceKey,
        displayName: 'Compromisos de compras SAP',
        schemaVersion: 1,
        parserVersion: '1.0.0',
        config: { semanticDomain: 'PROCUREMENT_COMMITMENT' },
      },
    });
    assert(sourceResponse.statusCode === 201, `Source create failed: ${sourceResponse.statusCode} ${sourceResponse.body}`);
    const source = sourceResponse.json<{ id: string; sourceKey: string }>();
    assert(source.sourceKey === sourceKey, 'Source key was not preserved as logical semantic identity.');

    const uploadHeaders = {
      'content-type': 'application/octet-stream',
      'x-bridata-file-name': 'cualquier_nombre_referencial.xlsx',
      'x-bridata-original-content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'x-bridata-source-generated-at': '2026-08-29T18:00:00.000Z',
    };
    const firstUpload = await app.inject({
      method: 'POST',
      url: `/api/v1/integrations/sap/sources/${source.id}/imports`,
      headers: uploadHeaders,
      payload: fileBytes,
    });
    assert(firstUpload.statusCode === 201, `First import failed: ${firstUpload.statusCode} ${firstUpload.body}`);
    const first = firstUpload.json<{ duplicate: boolean; batch: { id: string; checksumSha256: string; originalFilename: string } }>();
    assert(first.duplicate === false, 'First upload was incorrectly classified as duplicate.');
    assert(first.batch.checksumSha256 === expectedChecksum, 'Backend SHA-256 does not match source bytes.');
    assert(first.batch.originalFilename === 'cualquier_nombre_referencial.xlsx', 'Filename evidence was not retained.');

    const duplicateUpload = await app.inject({
      method: 'POST',
      url: `/api/v1/integrations/sap/sources/${source.id}/imports`,
      headers: { ...uploadHeaders, 'x-bridata-file-name': 'otro_nombre_del_mismo_archivo.xlsx' },
      payload: fileBytes,
    });
    assert(duplicateUpload.statusCode === 200, `Duplicate import failed: ${duplicateUpload.statusCode} ${duplicateUpload.body}`);
    const duplicate = duplicateUpload.json<{ duplicate: boolean; batch: { id: string } }>();
    assert(duplicate.duplicate === true, 'Same bytes were not detected as idempotent duplicate.');
    assert(duplicate.batch.id === first.batch.id, 'Duplicate upload produced a second import batch.');

    const servicePrincipalResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/integrations/sap/connections/${connection.id}/service-principals`,
      payload: {
        clientId: randomUUID(),
        displayName: 'SAP Import Agent Smoke',
        allowedSourceKeys: [sourceKey],
      },
    });
    assert(servicePrincipalResponse.statusCode === 201, `Service principal foundation failed: ${servicePrincipalResponse.statusCode} ${servicePrincipalResponse.body}`);

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/integrations/sap/imports/${first.batch.id}`,
    });
    assert(detailResponse.statusCode === 200, `Import detail failed: ${detailResponse.statusCode} ${detailResponse.body}`);
    const detailText = detailResponse.body;
    assert(!detailText.includes('storage_key') && !detailText.includes('storageKey'), 'Internal Blob storage key leaked through import detail API.');

    const downloadResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/integrations/sap/imports/${first.batch.id}/download-link`,
    });
    assert(downloadResponse.statusCode === 200, `Original import download authorization failed: ${downloadResponse.statusCode} ${downloadResponse.body}`);
    const download = downloadResponse.json<{ url: string }>();
    assert(download.url.startsWith('data:'), 'Memory binary adapter did not return controlled original content access.');

    const persisted = await withTenant(TENANT_ID, async (tx) => {
      const [sourceCount, batchCount, principalCount, audits, events] = await Promise.all([
        tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM integration_sources WHERE id = ${source.id}::uuid`,
        tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM integration_import_batches WHERE id = ${first.batch.id}::uuid`,
        tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM integration_service_principals WHERE integration_connection_id = ${connection.id}::uuid`,
        tx.auditLog.count({ where: { tenantId: TENANT_ID, resourceId: first.batch.id, action: 'INTEGRATION_IMPORT_RECEIVED' } }),
        tx.domainEvent.count({ where: { tenantId: TENANT_ID, aggregateId: first.batch.id, eventType: 'bridata.integration.import.received' } }),
      ]);
      return {
        sourceCount: Number(sourceCount[0]?.count ?? 0),
        batchCount: Number(batchCount[0]?.count ?? 0),
        principalCount: Number(principalCount[0]?.count ?? 0),
        audits,
        events,
      };
    });
    assert(persisted.sourceCount === 1, 'Integration source did not persist.');
    assert(persisted.batchCount === 1, 'Import batch did not persist exactly once.');
    assert(persisted.principalCount === 1, 'Integration service principal foundation did not persist.');
    assert(persisted.audits === 1, 'Import reception audit event missing or duplicated.');
    assert(persisted.events === 1, 'Import reception domain event missing or duplicated.');

    const visibleWithoutTenant = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM integration_import_batches WHERE id = ${first.batch.id}::uuid
    `;
    assert(Number(visibleWithoutTenant[0]?.count ?? 0) === 0, 'Integration import RLS failed closed check.');

    let identityMutationBlocked = false;
    try {
      await withTenant(TENANT_ID, (tx) => tx.$executeRaw`
        UPDATE integration_import_batches
        SET checksum_sha256 = ${'0'.repeat(64)}
        WHERE id = ${first.batch.id}::uuid
      `);
    } catch {
      identityMutationBlocked = true;
    }
    assert(identityMutationBlocked, 'Import batch immutable identity guard did not reject checksum mutation.');

    console.info(JSON.stringify({
      sapIntegrationFoundationV1a: 'PASS',
      sourceAgnostic: true,
      filenameIsEvidenceOnly: true,
      sha256Idempotency: true,
      originalBinaryRetention: true,
      rlsFailClosed: true,
      immutableImportIdentity: true,
      auditAndDomainEvent: true,
      servicePrincipalFoundation: true,
    }));
  } finally {
    await app.close();
    await withTenant(TENANT_ID, (tx) => tx.integrationConnection.delete({ where: { id: connection.id } }));
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
