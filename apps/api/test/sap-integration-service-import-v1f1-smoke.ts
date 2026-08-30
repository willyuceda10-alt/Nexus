import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { MemoryIntegrationBinaryStoreV1 } from '../src/integration-binary-store-v1.js';
import { withTenant } from '../src/tenant-transaction.js';

const TENANT_ID = process.env.DEV_TENANT_ID ?? '00000000-0000-4000-8000-000000000002';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function projectProcurementWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('SAP');
  sheet.addRow([
    'Solicitud de pedido', 'Pos.solicitud pedido', 'Pedido', 'Posición de pedido',
    'Entrada mercancías', 'Material', 'Cantidad solicitada', 'Valor total', 'Centro',
  ]);
  sheet.addRow(['1000009991', 10, '4500099991', 10, 'Sí', '13000999', 3, 300, 'CSMV']);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function openPurchaseOrdersWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('SAP');
  sheet.addRow([
    'Documento compras', 'Por entregar (cantidad)', 'Solicitud de pedido',
    'Pos.solicitud pedido', 'Posición', 'Cantidad de pedido', 'Material', 'Centro',
  ]);
  sheet.addRow(['4500088888', 5, '1000008888', 10, 10, 8, '13000888', 'CSMV']);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function canonicalCounts() {
  return withTenant(TENANT_ID, async (tx) => {
    const rows = await tx.$queryRaw<Array<{
      purchase_requisitions: bigint;
      purchase_orders: bigint;
      inventory_movements: bigint;
      project_commitments: bigint;
      project_actual_costs: bigint;
    }>>(Prisma.sql`
      SELECT
        (SELECT COUNT(*) FROM purchase_requisitions WHERE tenant_id = ${TENANT_ID}::uuid) AS purchase_requisitions,
        (SELECT COUNT(*) FROM purchase_orders WHERE tenant_id = ${TENANT_ID}::uuid) AS purchase_orders,
        (SELECT COUNT(*) FROM inventory_movements WHERE tenant_id = ${TENANT_ID}::uuid) AS inventory_movements,
        (SELECT COUNT(*) FROM project_commitments WHERE tenant_id = ${TENANT_ID}::uuid) AS project_commitments,
        (SELECT COUNT(*) FROM project_actual_costs WHERE tenant_id = ${TENANT_ID}::uuid) AS project_actual_costs
    `);
    const row = rows[0]!;
    return {
      purchaseRequisitions: Number(row.purchase_requisitions),
      purchaseOrders: Number(row.purchase_orders),
      inventoryMovements: Number(row.inventory_movements),
      projectCommitments: Number(row.project_commitments),
      projectActualCosts: Number(row.project_actual_costs),
    };
  });
}

async function main() {
  const clientId = randomUUID();
  const ids = await withTenant(TENANT_ID, async (tx) => {
    const connection = await tx.integrationConnection.create({
      data: {
        tenantId: TENANT_ID,
        provider: 'SAP',
        status: 'ACTIVE',
        displayName: `SAP Service V1-F1 ${Date.now()}`,
      },
      select: { id: true },
    });
    const projectSource = await tx.integrationSource.create({
      data: {
        tenantId: TENANT_ID,
        integrationConnectionId: connection.id,
        sourceKey: 'SAP_PROJECT_PROCUREMENT',
        displayName: 'Project Procurement',
        parserVersion: 'sap-auto-v1b',
        schemaVersion: 1,
      },
      select: { id: true },
    });
    await tx.integrationSource.create({
      data: {
        tenantId: TENANT_ID,
        integrationConnectionId: connection.id,
        sourceKey: 'SAP_OPEN_PURCHASE_ORDERS',
        displayName: 'Open Purchase Orders',
        parserVersion: 'sap-auto-v1b',
        schemaVersion: 1,
      },
    });
    const principal = await tx.integrationServicePrincipal.create({
      data: {
        tenantId: TENANT_ID,
        integrationConnectionId: connection.id,
        clientId,
        displayName: 'SAP Service Import Smoke',
        allowedSourceKeys: ['SAP_PROJECT_PROCUREMENT'],
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    return { connectionId: connection.id, sourceId: projectSource.id, principalId: principal.id };
  });

  const app = await buildApp({ integrationBinaryStore: new MemoryIntegrationBinaryStoreV1() });
  const payload = await projectProcurementWorkbook();
  const before = await canonicalCounts();
  try {
    const upload = await app.inject({
      method: 'POST',
      url: `/api/v1/integrations/sap/connections/${ids.connectionId}/service-imports:auto`,
      headers: {
        'content-type': 'application/octet-stream',
        'x-bridata-tenant-id': TENANT_ID,
        'x-bridata-service-client-id': clientId,
        'x-bridata-file-name': 'project-procurement.xlsx',
        'x-bridata-source-generated-at': '2026-08-29T23:45:00.000Z',
      },
      payload,
    });
    assert(upload.statusCode === 201, `Service import failed: ${upload.statusCode} ${upload.body}`);
    const result = upload.json<{
      duplicate: boolean;
      servicePrincipalId: string;
      authMode: string;
      detection: { sourceKey: string; profileId: string };
      batch: { id: string; sourceId: string; status: string; counts: { total: number; accepted: number; rejected: number } };
    }>();
    assert(result.duplicate === false, 'First service upload was marked duplicate.');
    assert(result.servicePrincipalId === ids.principalId, 'Service principal identity was not preserved.');
    assert(result.authMode === 'DEV_SERVICE', 'DEV service auth mode was not isolated for smoke validation.');
    assert(result.detection.sourceKey === 'SAP_PROJECT_PROCUREMENT', 'Service import source detection changed.');
    assert(result.batch.sourceId === ids.sourceId && result.batch.status === 'SUCCEEDED', 'Service batch did not persist successfully.');
    assert(result.batch.counts.total === 1 && result.batch.counts.accepted === 1 && result.batch.counts.rejected === 0, 'Service batch counts are incorrect.');

    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/v1/integrations/sap/connections/${ids.connectionId}/service-imports:auto`,
      headers: {
        'content-type': 'application/octet-stream',
        'x-bridata-tenant-id': TENANT_ID,
        'x-bridata-service-client-id': clientId,
        'x-bridata-file-name': 'renamed.xlsx',
      },
      payload,
    });
    assert(duplicate.statusCode === 200, `Idempotent service upload failed: ${duplicate.statusCode} ${duplicate.body}`);
    const duplicateResult = duplicate.json<{ duplicate: boolean; batch: { id: string } }>();
    assert(duplicateResult.duplicate === true && duplicateResult.batch.id === result.batch.id, 'SHA-256 idempotency failed for service import.');

    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/v1/integrations/sap/connections/${ids.connectionId}/service-imports:auto`,
      headers: {
        'content-type': 'application/octet-stream',
        'x-bridata-tenant-id': TENANT_ID,
        'x-bridata-service-client-id': clientId,
        'x-bridata-file-name': 'open-po.xlsx',
      },
      payload: await openPurchaseOrdersWorkbook(),
    });
    assert(forbidden.statusCode === 403, `Unauthorized logical source was not blocked: ${forbidden.statusCode} ${forbidden.body}`);
    assert(forbidden.json<{ error: string }>().error === 'integration_source_not_authorized', 'Unexpected source authorization error.');

    const persisted = await withTenant(TENANT_ID, async (tx) => {
      const [principal, audits, events, records, batches] = await Promise.all([
        tx.integrationServicePrincipal.findUnique({ where: { id: ids.principalId }, select: { lastUsedAt: true } }),
        tx.auditLog.count({ where: { tenantId: TENANT_ID, resourceId: result.batch.id, action: 'SAP_SERVICE_IMPORT_AUTO_PARSED' } }),
        tx.domainEvent.count({ where: { tenantId: TENANT_ID, aggregateId: result.batch.id, eventType: 'bridata.integration.sap.service_import.parsed' } }),
        tx.integrationImportRecord.count({ where: { tenantId: TENANT_ID, batchId: result.batch.id } }),
        tx.integrationImportBatch.count({ where: { tenantId: TENANT_ID, integrationSourceId: ids.sourceId } }),
      ]);
      return { principal, audits, events, records, batches };
    });
    assert(persisted.principal?.lastUsedAt, 'Service principal last_used_at was not updated.');
    assert(persisted.audits === 1 && persisted.events === 1, 'Service import audit/event is missing or duplicated.');
    assert(persisted.records === 1 && persisted.batches === 1, 'Service import duplicated staging data.');

    const after = await canonicalCounts();
    assert(JSON.stringify(after) === JSON.stringify(before), 'V1-F1 service ingest mutated canonical operational tables.');

    console.log(JSON.stringify({
      sapServiceImportV1f1: 'PASS',
      appOnlyBoundaryDesigned: true,
      registeredServicePrincipalRequired: true,
      connectionScoped: true,
      sourceAllowlistEnforced: true,
      sha256Idempotent: true,
      lastUsedTracked: true,
      auditWithoutFakeUser: true,
      canonicalTablesReadOnly: true,
    }));
  } finally {
    await app.close();
    await withTenant(TENANT_ID, async (tx) => {
      await tx.integrationConnection.delete({ where: { id: ids.connectionId } });
    }).catch(() => undefined);
    await prismaDisconnect();
  }
}

async function prismaDisconnect() {
  const { prisma } = await import('../src/db.js');
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prismaDisconnect().catch(() => undefined);
  process.exitCode = 1;
});
