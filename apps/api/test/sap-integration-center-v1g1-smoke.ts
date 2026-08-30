import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { withTenant } from '../src/tenant-transaction.js';

const tenantId = process.env.DEV_TENANT_ID ?? '00000000-0000-4000-8000-000000000002';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const connectionId = randomUUID();
  const sourceId = randomUUID();
  const app = await buildApp();
  await app.ready();

  try {
    const generatedAt = new Date(Date.now() - 10 * 60_000);
    await withTenant(tenantId, async (tx) => {
      await tx.integrationConnection.create({
        data: {
          id: connectionId,
          tenantId,
          provider: 'SAP',
          status: 'ACTIVE',
          displayName: 'SAP Integration Center V1-G1 smoke',
          config: {
            sapAutomationV1f2: {
              enabled: true,
              workspaceId: '00000000-0000-4000-8000-000000000003',
              ownerUserId: '00000000-0000-4000-8000-000000000001',
              requiredSourceKeys: [
                'SAP_PROCUREMENT_COMMITMENTS',
                'SAP_PROJECT_PROCUREMENT',
                'SAP_OPEN_PURCHASE_ORDERS',
                'SAP_MATERIAL_MOVEMENTS',
                'SAP_PROJECT_ACTUAL_COSTS',
              ],
              version: 'v1f2',
            },
          },
        },
      });
      await tx.integrationSource.create({
        data: {
          id: sourceId,
          tenantId,
          integrationConnectionId: connectionId,
          sourceKey: 'SAP_PROJECT_PROCUREMENT',
          displayName: 'Aprovisionamiento por proyecto',
          schemaVersion: 1,
          parserVersion: 'v1g1-smoke',
          config: { freshnessMinutes: 60 },
          lastSuccessAt: new Date(),
          lastGeneratedAt: generatedAt,
        },
      });
      await tx.integrationImportBatch.create({
        data: {
          tenantId,
          integrationSourceId: sourceId,
          originalFilename: 'sap-project-procurement-v1g1.xlsx',
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          fileSize: 1024n,
          checksumSha256: 'a'.repeat(64),
          storageKey: `${tenantId}/${connectionId}/${sourceId}/v1g1-smoke`,
          sourceGeneratedAt: generatedAt,
          status: 'SUCCEEDED',
          schemaVersion: 1,
          parserVersion: 'v1g1-smoke',
          totalRecords: 1245,
          acceptedRecords: 1245,
          warningRecords: 0,
          rejectedRecords: 0,
          processingStartedAt: new Date(),
          processingFinishedAt: new Date(),
        },
      });
    });

    const first = await app.inject({ method: 'GET', url: '/api/v1/integrations/sap/center-v1g1' });
    assert(first.statusCode === 200, `Integration Center lookup failed: ${first.statusCode} ${first.body}`);
    const payload = first.json();
    assert(payload.version === 'v1g1', 'Unexpected Integration Center version');
    assert(payload.canonicalDatabase === 'BRIDATA_POSTGRESQL', 'Operational database boundary missing');
    const connection = payload.connections.find((item: { id: string }) => item.id === connectionId);
    assert(connection, 'SAP connection missing from Integration Center');
    assert(connection.summary.expectedSources === 5, 'Expected five semantic SAP sources');
    assert(connection.summary.configuredSources === 1, 'Expected one configured source');
    assert(connection.summary.fresh === 1, 'Fresh source not reflected in connection summary');
    assert(connection.summary.never === 4, 'Missing sources must remain visible as NEVER');
    assert(connection.overallStatus === 'DEGRADED', 'Four never-loaded sources must degrade the connection');
    assert(connection.automation.configured === true && connection.automation.enabled === true, 'F2 automation profile missing');
    const procurement = connection.sources.find((source: { sourceKey: string }) => source.sourceKey === 'SAP_PROJECT_PROCUREMENT');
    assert(procurement?.freshnessState === 'FRESH', `Expected FRESH procurement source, got ${procurement?.freshnessState}`);
    assert(procurement?.qualityState === 'CLEAN', `Expected CLEAN procurement source, got ${procurement?.qualityState}`);
    assert(procurement?.latestBatch?.counts.total === 1245, 'Latest batch counts not projected');
    assert(procurement?.latestBatch?.originalFilename === 'sap-project-procurement-v1g1.xlsx', 'Evidence filename missing');

    await withTenant(tenantId, async (tx) => {
      await tx.integrationSource.update({
        where: { id: sourceId },
        data: { config: { freshnessMinutes: 5 } },
      });
    });

    const second = await app.inject({ method: 'GET', url: '/api/v1/integrations/sap/center-v1g1' });
    assert(second.statusCode === 200, `Second Integration Center lookup failed: ${second.statusCode}`);
    const staleConnection = second.json().connections.find((item: { id: string }) => item.id === connectionId);
    const staleProcurement = staleConnection?.sources.find((source: { sourceKey: string }) => source.sourceKey === 'SAP_PROJECT_PROCUREMENT');
    assert(staleProcurement?.freshnessState === 'STALE', 'V1-E freshness policy must drive the Integration Center');

    console.log(JSON.stringify({
      sapIntegrationCenterV1g1: 'PASS',
      fiveSemanticSourcesVisible: true,
      sourceGeneratedFreshnessUsed: true,
      latestBatchEvidenceVisible: true,
      automationProfileVisible: true,
      canonicalDatabaseBoundaryVisible: true,
      missingSourcesFailClosed: true,
    }));
  } finally {
    await withTenant(tenantId, async (tx) => {
      await tx.integrationConnection.delete({ where: { id: connectionId } });
    }).catch(() => undefined);
    await app.close();
    const { prisma } = await import('../src/db.js');
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
