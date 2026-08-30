import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { withTenant } from '../src/tenant-transaction.js';

const tenantId = process.env.DEV_TENANT_ID ?? '00000000-0000-4000-8000-000000000002';
const userId = process.env.DEV_USER_ID ?? '00000000-0000-4000-8000-000000000001';
const workspaceId = '00000000-0000-4000-8000-000000000003';
const projectId = '00000000-0000-4000-8000-000000000101';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const suffix = Date.now().toString().slice(-8);
  const connectionId = randomUUID();
  const sourceId = randomUUID();
  const batchId = randomUUID();
  const materialObjectId = randomUUID();
  const materialId = randomUUID();
  const warehouseId = randomUUID();
  const supplierId = randomUUID();
  const requisitionId = randomUUID();
  const requisitionLineId = randomUUID();
  const purchaseOrderId = randomUUID();
  const purchaseOrderLineId = randomUUID();
  const receiptMovementId = randomUUID();
  const issueMovementId = randomUUID();
  const wbsElement = `G2-${suffix}`;
  const requisitionNumber = `PR-G2-${suffix}`;
  const purchaseOrderNumber = `PO-G2-${suffix}`;
  const materialCode = `MAT-G2-${suffix}`;
  const app = await buildApp();
  await app.ready();

  try {
    await withTenant(tenantId, async (tx) => {
      const definition = await tx.objectDefinition.findFirst({
        where: { tenantId, key: 'MATERIAL' },
        select: { id: true },
      });
      assert(definition, 'MATERIAL object definition missing');
      const uomRows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM unit_of_measures
        WHERE tenant_id = ${tenantId}::uuid AND is_active = true
        ORDER BY code LIMIT 1
      `);
      assert(uomRows[0], 'Seed UOM missing');
      const uomId = uomRows[0].id;

      await tx.nexusObject.create({
        data: {
          id: materialObjectId,
          tenantId,
          workspaceId,
          objectDefinitionId: definition.id,
          objectTypeKey: 'MATERIAL',
          title: `Material SAP G2 ${suffix}`,
          status: 'ACTIVE',
          priority: 'MEDIUM',
          progress: 0,
          ownerId: userId,
          metadata: { source: 'SAP_G2_SMOKE' },
        },
      });

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO material_masters
          (id, tenant_id, workspace_id, material_object_id, code, base_uom_id, unit_cost, currency, is_active)
        VALUES
          (${materialId}::uuid, ${tenantId}::uuid, ${workspaceId}::uuid, ${materialObjectId}::uuid,
           ${materialCode}, ${uomId}::uuid, 12.50, 'USD', true)
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO warehouses (id, tenant_id, workspace_id, code, name, is_active)
        VALUES (${warehouseId}::uuid, ${tenantId}::uuid, ${workspaceId}::uuid,
                ${`WG2${suffix}`}, ${`Almacén G2 ${suffix}`}, true)
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO suppliers (id, tenant_id, code, name, is_active)
        VALUES (${supplierId}::uuid, ${tenantId}::uuid, ${`SG2${suffix}`}, ${`Proveedor G2 ${suffix}`}, true)
      `);

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO purchase_requisitions
          (id, tenant_id, workspace_id, project_object_id, number, status, requested_by_user_id, notes)
        VALUES (${requisitionId}::uuid, ${tenantId}::uuid, ${workspaceId}::uuid, ${projectId}::uuid,
                ${requisitionNumber}, 'CONVERTED', ${userId}::uuid, 'G2 smoke')
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO purchase_requisition_lines
          (id, tenant_id, requisition_id, material_id, uom_id, quantity, estimated_unit_cost)
        VALUES (${requisitionLineId}::uuid, ${tenantId}::uuid, ${requisitionId}::uuid,
                ${materialId}::uuid, ${uomId}::uuid, 10, 12.50)
      `);

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO purchase_orders
          (id, tenant_id, workspace_id, project_object_id, supplier_id, number, status,
           order_date, expected_date, currency, notes)
        VALUES (${purchaseOrderId}::uuid, ${tenantId}::uuid, ${workspaceId}::uuid, ${projectId}::uuid,
                ${supplierId}::uuid, ${purchaseOrderNumber}, 'PARTIAL', CURRENT_DATE,
                CURRENT_DATE + 2, 'USD', 'G2 smoke')
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO purchase_order_lines
          (id, tenant_id, purchase_order_id, material_id, uom_id, quantity, received_qty, unit_cost, expected_date)
        VALUES (${purchaseOrderLineId}::uuid, ${tenantId}::uuid, ${purchaseOrderId}::uuid,
                ${materialId}::uuid, ${uomId}::uuid, 10, 6, 12.50, CURRENT_DATE + 2)
      `);

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO inventory_movements
          (id, tenant_id, workspace_id, warehouse_id, material_id, movement_type, quantity,
           unit_cost, occurred_at, reference_type, reference_id, created_by_user_id, notes)
        VALUES
          (${receiptMovementId}::uuid, ${tenantId}::uuid, ${workspaceId}::uuid, ${warehouseId}::uuid,
           ${materialId}::uuid, 'RECEIPT', 6, 12.50, CURRENT_TIMESTAMP,
           'PURCHASE_ORDER_LINE', ${purchaseOrderLineId}::uuid, ${userId}::uuid, 'SAP G2 101'),
          (${issueMovementId}::uuid, ${tenantId}::uuid, ${workspaceId}::uuid, ${warehouseId}::uuid,
           ${materialId}::uuid, 'ISSUE', 2, 12.50, CURRENT_TIMESTAMP,
           'SAP_IMPORT_RECORD', NULL, ${userId}::uuid, 'SAP G2 221')
      `);

      await tx.integrationConnection.create({
        data: { id: connectionId, tenantId, provider: 'SAP', status: 'ACTIVE', displayName: `SAP G2 ${suffix}` },
      });
      await tx.integrationSource.create({
        data: {
          id: sourceId,
          tenantId,
          integrationConnectionId: connectionId,
          sourceKey: 'SAP_PROJECT_PROCUREMENT',
          displayName: 'G2 project procurement',
          schemaVersion: 1,
          parserVersion: 'v1g2-smoke',
        },
      });
      await tx.integrationImportBatch.create({
        data: {
          id: batchId,
          tenantId,
          integrationSourceId: sourceId,
          originalFilename: 'g2-smoke.xlsx',
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          fileSize: 100n,
          checksumSha256: suffix.padEnd(64, 'a').slice(0, 64),
          storageKey: `${tenantId}/${connectionId}/g2-${suffix}`,
          status: 'SUCCEEDED',
          schemaVersion: 1,
          parserVersion: 'v1g2-smoke',
          totalRecords: 4,
          acceptedRecords: 4,
        },
      });

      const records = await Promise.all([
        tx.integrationImportRecord.create({
          data: {
            tenantId, batchId, rowNumber: 1, externalKey: `PR:${requisitionNumber}:00010`,
            recordHash: '1'.repeat(64), rawPayload: {}, normalizedPayload: { wbsElement }, processingStatus: 'APPLIED',
          }, select: { id: true },
        }),
        tx.integrationImportRecord.create({
          data: {
            tenantId, batchId, rowNumber: 2, externalKey: `PO:${purchaseOrderNumber}:00020`,
            recordHash: '2'.repeat(64), rawPayload: {}, normalizedPayload: { wbsElement }, processingStatus: 'APPLIED',
          }, select: { id: true },
        }),
        tx.integrationImportRecord.create({
          data: {
            tenantId, batchId, rowNumber: 3, externalKey: `MATDOC:2026:500${suffix}:0001`,
            recordHash: '3'.repeat(64), rawPayload: {}, normalizedPayload: { wbsElement }, processingStatus: 'APPLIED',
          }, select: { id: true },
        }),
        tx.integrationImportRecord.create({
          data: {
            tenantId, batchId, rowNumber: 4, externalKey: `MATDOC:2026:500${suffix}:0002`,
            recordHash: '4'.repeat(64), rawPayload: {}, normalizedPayload: { wbsElement }, processingStatus: 'APPLIED',
          }, select: { id: true },
        }),
      ]);

      await tx.integrationEntityLink.createMany({
        data: [
          {
            tenantId, integrationConnectionId: connectionId, sourceRecordId: null,
            externalEntityType: 'SAP_WBS_ELEMENT', externalKey: `WBS:${wbsElement}`,
            canonicalEntityType: 'PROJECT_OBJECT', canonicalEntityId: projectId,
            metadata: { source: 'SAP', workspaceId },
          },
          {
            tenantId, integrationConnectionId: connectionId, sourceRecordId: records[0].id,
            externalEntityType: 'SAP_PURCHASE_REQUISITION_LINE', externalKey: `PR:${requisitionNumber}:00010`,
            canonicalEntityType: 'PURCHASE_REQUISITION_LINE', canonicalEntityId: requisitionLineId,
          },
          {
            tenantId, integrationConnectionId: connectionId, sourceRecordId: records[1].id,
            externalEntityType: 'SAP_PURCHASE_ORDER_LINE', externalKey: `PO:${purchaseOrderNumber}:00020`,
            canonicalEntityType: 'PURCHASE_ORDER_LINE', canonicalEntityId: purchaseOrderLineId,
          },
          {
            tenantId, integrationConnectionId: connectionId, sourceRecordId: records[2].id,
            externalEntityType: 'SAP_MATERIAL_DOCUMENT_ITEM', externalKey: `MATDOC:2026:500${suffix}:0001`,
            canonicalEntityType: 'INVENTORY_MOVEMENT', canonicalEntityId: receiptMovementId,
            metadata: { source: 'SAP', sapMovementType: '101' },
          },
          {
            tenantId, integrationConnectionId: connectionId, sourceRecordId: records[3].id,
            externalEntityType: 'SAP_MATERIAL_DOCUMENT_ITEM', externalKey: `MATDOC:2026:500${suffix}:0002`,
            canonicalEntityType: 'INVENTORY_MOVEMENT', canonicalEntityId: issueMovementId,
            metadata: { source: 'SAP', sapMovementType: '221' },
          },
        ],
      });
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/material-engine-v2/sap-flow-v1g2?workspaceId=${workspaceId}&projectId=${projectId}`,
    });
    assert(response.statusCode === 200, `SAP material flow failed: ${response.statusCode} ${response.body}`);
    const payload = response.json();
    assert(payload.version === 'v1g2', 'Unexpected V1-G2 version');
    assert(payload.canonicalDatabase === 'BRIDATA_POSTGRESQL', 'PostgreSQL boundary missing');
    assert(payload.excelRuntimeDependency === false, 'Excel must not be a runtime dependency');
    const row = payload.materials.find((item: { materialCode: string }) => item.materialCode === materialCode);
    assert(row, 'G2 material missing from response');
    assert(row.requestedQty === 10, `Expected requested=10, got ${row.requestedQty}`);
    assert(row.orderedQty === 10, `Expected ordered=10, got ${row.orderedQty}`);
    assert(row.receivedQty === 6, `Expected received=6, got ${row.receivedQty}`);
    assert(row.outstandingQty === 4, `Expected outstanding=4, got ${row.outstandingQty}`);
    assert(row.consumedQty === 2, `Expected consumed=2, got ${row.consumedQty}`);
    assert(row.stockQty === 4, `Expected stock=4, got ${row.stockQty}`);
    assert(row.state === 'PARTIAL', `Expected PARTIAL, got ${row.state}`);
    assert(row.requisitions[0]?.position === '00010', 'SAP requisition position missing');
    assert(row.purchaseOrders[0]?.position === '00020', 'SAP purchase order position missing');
    assert(payload.rules.porLlegarDerived === 'PURCHASE_ORDER_QUANTITY_MINUS_RECEIVED_QTY', 'Por llegar must be derived');

    console.log(JSON.stringify({
      sapMaterialFlowV1g2: 'PASS',
      requestedQty: row.requestedQty,
      orderedQty: row.orderedQty,
      receivedQty: row.receivedQty,
      outstandingQty: row.outstandingQty,
      consumedQty: row.consumedQty,
      stockQty: row.stockQty,
      exactSapDocumentPositionsVisible: true,
      excelRuntimeDependency: false,
    }));
  } finally {
    await withTenant(tenantId, async (tx) => {
      await tx.$executeRaw(Prisma.sql`DELETE FROM inventory_movements WHERE id IN (${receiptMovementId}::uuid, ${issueMovementId}::uuid)`);
      await tx.$executeRaw(Prisma.sql`DELETE FROM purchase_order_lines WHERE id = ${purchaseOrderLineId}::uuid`);
      await tx.$executeRaw(Prisma.sql`DELETE FROM purchase_orders WHERE id = ${purchaseOrderId}::uuid`);
      await tx.$executeRaw(Prisma.sql`DELETE FROM purchase_requisition_lines WHERE id = ${requisitionLineId}::uuid`);
      await tx.$executeRaw(Prisma.sql`DELETE FROM purchase_requisitions WHERE id = ${requisitionId}::uuid`);
      await tx.$executeRaw(Prisma.sql`DELETE FROM suppliers WHERE id = ${supplierId}::uuid`);
      await tx.$executeRaw(Prisma.sql`DELETE FROM warehouses WHERE id = ${warehouseId}::uuid`);
      await tx.integrationConnection.delete({ where: { id: connectionId } }).catch(() => undefined);
      await tx.nexusObject.delete({ where: { id: materialObjectId } }).catch(() => undefined);
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
