import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { MemoryIntegrationBinaryStoreV1 } from '../src/integration-binary-store-v1.js';
import { withTenant } from '../src/tenant-transaction.js';

const tenantId = process.env.DEV_TENANT_ID ?? '00000000-0000-4000-8000-000000000002';
const userId = process.env.DEV_USER_ID ?? '00000000-0000-4000-8000-000000000001';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function workbook(): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('SAP');
  sheet.addRow([
    'Solicitud de pedido',
    'Pos.solicitud pedido',
    'Pedido',
    'Posición de pedido',
    'Entrada mercancías',
    'Material',
    'Cantidad solicitada',
    'Valor total',
    'Moneda',
    'Centro',
  ]);
  sheet.addRow(['1000009999', 10, '4500099999', 20, 'Sí', '13009999', 5, 50, 'USD', '1000']);
  return Buffer.from(await book.xlsx.writeBuffer());
}

async function canonicalCounts() {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.$queryRaw<Array<{
      materials: bigint;
      purchase_orders: bigint;
      inventory_movements: bigint;
      actual_costs: bigint;
    }>>(Prisma.sql`
      SELECT
        (SELECT COUNT(*) FROM material_masters WHERE tenant_id=${tenantId}::uuid)::bigint AS materials,
        (SELECT COUNT(*) FROM purchase_orders WHERE tenant_id=${tenantId}::uuid)::bigint AS purchase_orders,
        (SELECT COUNT(*) FROM inventory_movements WHERE tenant_id=${tenantId}::uuid)::bigint AS inventory_movements,
        (SELECT COUNT(*) FROM project_actual_costs WHERE tenant_id=${tenantId}::uuid)::bigint AS actual_costs
    `);
    const row = rows[0]!;
    return {
      materials: Number(row.materials),
      purchaseOrders: Number(row.purchase_orders),
      inventoryMovements: Number(row.inventory_movements),
      actualCosts: Number(row.actual_costs),
    };
  });
}

async function main() {
  const connectionId = randomUUID();
  const binaryStore = new MemoryIntegrationBinaryStoreV1();
  const app = await buildApp({ integrationBinaryStore: binaryStore });
  await app.ready();

  await withTenant(tenantId, async (tx) => {
    await tx.integrationConnection.create({
      data: {
        id: connectionId,
        tenantId,
        provider: 'SAP',
        status: 'ACTIVE',
        displayName: 'SAP V1-E health smoke',
      },
    });
  });

  const beforeCanonical = await canonicalCounts();

  const emptyHealth = await app.inject({
    method: 'GET',
    url: `/api/v1/integrations/sap/connections/${connectionId}/health-v1e`,
  });
  assert(emptyHealth.statusCode === 200, `Initial health failed: ${emptyHealth.statusCode} ${emptyHealth.body}`);
  const empty = emptyHealth.json();
  assert(empty.connection.overallStatus === 'DEGRADED', 'Missing SAP sources must degrade connection health');
  assert(empty.summary.never === 5, `Expected five never-loaded sources, got ${empty.summary.never}`);

  const generatedAt = new Date(Date.now() - 15 * 60_000).toISOString();
  const imported = await app.inject({
    method: 'POST',
    url: `/api/v1/integrations/sap/connections/${connectionId}/imports:auto`,
    headers: {
      'content-type': 'application/octet-stream',
      'x-bridata-file-name': 'sap-project-procurement-v1e.xlsx',
      'x-bridata-source-generated-at': generatedAt,
    },
    payload: await workbook(),
  });
  assert(imported.statusCode === 201, `V1-E staging import failed: ${imported.statusCode} ${imported.body}`);
  const importedPayload = imported.json();
  assert(importedPayload.detection.sourceKey === 'SAP_PROJECT_PROCUREMENT', 'Unexpected detected source');

  const freshHealth = await app.inject({
    method: 'GET',
    url: `/api/v1/integrations/sap/connections/${connectionId}/health-v1e`,
  });
  assert(freshHealth.statusCode === 200, `Fresh health failed: ${freshHealth.statusCode} ${freshHealth.body}`);
  const fresh = freshHealth.json();
  const procurement = fresh.sources.find((source: { sourceKey: string }) => source.sourceKey === 'SAP_PROJECT_PROCUREMENT');
  assert(procurement, 'Project procurement health source missing');
  assert(procurement.freshnessState === 'FRESH', `Expected fresh source, got ${procurement.freshnessState}`);
  assert(procurement.qualityState === 'CLEAN', `Expected clean source, got ${procurement.qualityState}`);
  assert(procurement.dataAgeMinutes >= 14, 'Source-generated age was not used');
  assert(fresh.summary.configuredExpectedSources === 1, 'Expected one configured logical source');

  const policy = await app.inject({
    method: 'PUT',
    url: `/api/v1/integrations/sap/connections/${connectionId}/sources/${procurement.sourceId}/freshness-v1e`,
    payload: { freshnessMinutes: 5 },
  });
  assert(policy.statusCode === 200, `Freshness policy update failed: ${policy.statusCode} ${policy.body}`);
  assert(policy.json().freshnessMinutes === 5, 'Freshness policy was not persisted');

  const staleHealth = await app.inject({
    method: 'GET',
    url: `/api/v1/integrations/sap/connections/${connectionId}/health-v1e`,
  });
  const stale = staleHealth.json().sources.find((source: { sourceKey: string }) => source.sourceKey === 'SAP_PROJECT_PROCUREMENT');
  assert(stale?.freshnessState === 'STALE', `Expected stale after tightening policy, got ${stale?.freshnessState}`);

  await withTenant(tenantId, async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO integration_import_batches
        (tenant_id, integration_source_id, original_filename, content_type, file_size,
         checksum_sha256, storage_key, source_generated_at, received_at,
         processing_started_at, processing_finished_at, status, schema_version,
         parser_version, total_records, accepted_records, rejected_records, error_summary, updated_at)
      VALUES
        (${tenantId}::uuid, ${procurement.sourceId}::uuid, 'failed-v1e.xlsx',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 1,
         ${'f'.repeat(64)}, ${`${tenantId}/${connectionId}/${procurement.sourceId}/failed-v1e`},
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + interval '1 second',
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'FAILED', 1, 'v1e-smoke', 1, 0, 1,
         'Synthetic latest failure for health validation', CURRENT_TIMESTAMP)
    `);
  });

  const failedHealth = await app.inject({
    method: 'GET',
    url: `/api/v1/integrations/sap/connections/${connectionId}/health-v1e`,
  });
  assert(failedHealth.statusCode === 200, `Failed health lookup failed: ${failedHealth.statusCode} ${failedHealth.body}`);
  const failedPayload = failedHealth.json();
  const failedSource = failedPayload.sources.find((source: { sourceKey: string }) => source.sourceKey === 'SAP_PROJECT_PROCUREMENT');
  assert(failedSource?.freshnessState === 'ERROR', `Newer failed batch must be visible, got ${failedSource?.freshnessState}`);
  assert(failedPayload.connection.overallStatus === 'ERROR', 'Source failure must elevate connection health to ERROR');
  assert(failedSource.latestSuccessfulBatch?.status === 'SUCCEEDED', 'Last successful evidence should remain visible');

  const afterCanonical = await canonicalCounts();
  assert(JSON.stringify(beforeCanonical) === JSON.stringify(afterCanonical), 'V1-E health monitoring modified canonical operational tables');

  const policyAudit = await withTenant(tenantId, async (tx) => tx.auditLog.findFirst({
    where: {
      tenantId,
      userId,
      action: 'SAP_SOURCE_FRESHNESS_POLICY_UPDATED',
      resourceId: procurement.sourceId,
    },
    select: { id: true },
  }));
  assert(policyAudit, 'Freshness policy audit evidence missing');

  console.log(JSON.stringify({
    sapIntegrationHealthV1e: 'PASS',
    expectedLogicalSourcesVisible: true,
    sourceGeneratedFreshness: true,
    configurableFreshnessPolicy: true,
    staleDetection: true,
    latestFailureVisible: true,
    lastSuccessEvidencePreserved: true,
    canonicalTablesReadOnly: true,
  }));

  await app.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
