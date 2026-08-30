import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { withTenant } from '../src/tenant-transaction.js';

const tenantId = process.env.DEV_TENANT_ID ?? '00000000-0000-4000-8000-000000000002';
const userId = process.env.DEV_USER_ID ?? '00000000-0000-4000-8000-000000000001';
const workspaceId = '00000000-0000-4000-8000-000000000003';

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
  const materialCode = `MAT-G4-${suffix}`;
  const warehouseCode = `WG4${suffix}`;
  const docNumber = `51${suffix}`;
  const movementIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const app = await buildApp();
  await app.ready();

  try {
    await withTenant(tenantId, async (tx) => {
      const definition = await tx.objectDefinition.findFirst({
        where: { tenantId, key: 'MATERIAL' },
        select: { id: true },
      });
      assert(definition, 'MATERIAL object definition missing');
      const uomRows = await tx.$queryRaw<Array<{ id: string; code: string }>>(Prisma.sql`
        SELECT id, code FROM unit_of_measures
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
          title: `Material SAP G4 ${suffix}`,
          status: 'ACTIVE',
          priority: 'MEDIUM',
          progress: 0,
          ownerId: userId,
          metadata: { source: 'SAP_G4_SMOKE' },
        },
      });
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO material_masters
          (id, tenant_id, workspace_id, material_object_id, code, base_uom_id, unit_cost, currency, is_active)
        VALUES
          (${materialId}::uuid, ${tenantId}::uuid, ${workspaceId}::uuid, ${materialObjectId}::uuid,
           ${materialCode}, ${uomId}::uuid, 5.00, 'USD', true)
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO warehouses (id, tenant_id, workspace_id, code, name, is_active)
        VALUES (${warehouseId}::uuid, ${tenantId}::uuid, ${workspaceId}::uuid,
                ${warehouseCode}, ${`Almacén G4 ${suffix}`}, true)
      `);

      await tx.integrationConnection.create({
        data: { id: connectionId, tenantId, provider: 'SAP', status: 'ACTIVE', displayName: `SAP G4 ${suffix}` },
      });
      await tx.integrationSource.create({
        data: {
          id: sourceId,
          tenantId,
          integrationConnectionId: connectionId,
          sourceKey: 'SAP_MATERIAL_MOVEMENTS',
          displayName: 'G4 material movements',
          schemaVersion: 1,
          parserVersion: 'v1g4-smoke',
        },
      });
      await tx.integrationImportBatch.create({
        data: {
          id: batchId,
          tenantId,
          integrationSourceId: sourceId,
          originalFilename: 'g4-movements.xlsx',
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          fileSize: 100n,
          checksumSha256: suffix.padEnd(64, 'a').slice(0, 64),
          storageKey: `${tenantId}/${connectionId}/g4-${suffix}`,
          status: 'SUCCEEDED',
          schemaVersion: 1,
          parserVersion: 'v1g4-smoke',
          totalRecords: 4,
          acceptedRecords: 4,
        },
      });

      const specs = [
        { row: 1, item: '0001', bwart: '101', canonical: 'RECEIPT', quantity: 10, hash: '1'.repeat(64) },
        { row: 2, item: '0002', bwart: '102', canonical: 'ADJUSTMENT_OUT', quantity: 2, hash: '2'.repeat(64) },
        { row: 3, item: '0003', bwart: '221', canonical: 'ISSUE', quantity: 3, hash: '3'.repeat(64) },
        { row: 4, item: '0004', bwart: '222', canonical: 'ADJUSTMENT_IN', quantity: 1, hash: '4'.repeat(64) },
      ] as const;

      for (const [index, spec] of specs.entries()) {
        const externalKey = `MATDOC:2026:${docNumber}:${spec.item}`;
        const record = await tx.integrationImportRecord.create({
          data: {
            tenantId,
            batchId,
            rowNumber: spec.row,
            externalKey,
            recordHash: spec.hash,
            rawPayload: {},
            normalizedPayload: {
              wbsElement: `G4-PEP-${suffix}`,
              purchaseOrderNumber: spec.bwart === '101' || spec.bwart === '102' ? `45${suffix}` : null,
              purchaseOrderPosition: spec.bwart === '101' || spec.bwart === '102' ? '00010' : null,
            },
            processingStatus: 'APPLIED',
          },
          select: { id: true },
        });

        await tx.$executeRaw(Prisma.sql`
          INSERT INTO inventory_movements
            (id, tenant_id, workspace_id, warehouse_id, material_id, movement_type, quantity,
             unit_cost, occurred_at, reference_type, reference_id, created_by_user_id, notes)
          VALUES
            (${movementIds[index]}::uuid, ${tenantId}::uuid, ${workspaceId}::uuid, ${warehouseId}::uuid,
             ${materialId}::uuid, ${spec.canonical}, ${spec.quantity}, 5.00,
             CURRENT_TIMESTAMP - (${4 - spec.row} * INTERVAL '1 minute'),
             'SAP_IMPORT_RECORD', ${record.id}::uuid, ${userId}::uuid,
             ${`SAP ${externalKey}; BWART ${spec.bwart}; PEP G4-PEP-${suffix}`})
        `);

        await tx.integrationEntityLink.create({
          data: {
            tenantId,
            integrationConnectionId: connectionId,
            sourceRecordId: record.id,
            externalEntityType: 'SAP_MATERIAL_DOCUMENT_ITEM',
            externalKey,
            canonicalEntityType: 'INVENTORY_MOVEMENT',
            canonicalEntityId: movementIds[index]!,
            metadata: { source: 'SAP', canonicalSyncVersion: 'v1d2', sapMovementType: spec.bwart },
          },
        });
      }
    });

    const inventoryResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/material-engine-v2/sap-inventory-v1g4?workspaceId=${workspaceId}&materialId=${materialId}&warehouseId=${warehouseId}`,
    });
    assert(inventoryResponse.statusCode === 200, `G4 inventory failed: ${inventoryResponse.statusCode} ${inventoryResponse.body}`);
    const payload = inventoryResponse.json();
    assert(payload.version === 'v1g4', 'Unexpected G4 version');
    assert(payload.canonicalDatabase === 'BRIDATA_POSTGRESQL', 'Canonical PostgreSQL boundary missing');
    assert(payload.excelRuntimeDependency === false, 'Excel must not be runtime dependency');
    assert(payload.movements.length === 4, `Expected 4 movements, got ${payload.movements.length}`);

    const byType = new Map(payload.movements.map((item: { sapMovementType: string; signedQuantity: number; materialDocumentNumber: string; materialDocumentItem: string }) => [item.sapMovementType, item]));
    assert(byType.get('101')?.signedQuantity === 10, '101 must add stock');
    assert(byType.get('102')?.signedQuantity === -2, '102 must reverse receipt');
    assert(byType.get('221')?.signedQuantity === -3, '221 must consume stock');
    assert(byType.get('222')?.signedQuantity === 1, '222 must reverse consumption');
    assert(byType.get('101')?.materialDocumentNumber === docNumber, 'MATDOC document must be visible');
    assert(byType.get('101')?.materialDocumentItem === '0001', 'MATDOC item must be visible');

    const stockResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/material-engine-v2/overview?workspaceId=${workspaceId}`,
    });
    assert(stockResponse.statusCode === 200, `Stock overview failed: ${stockResponse.statusCode} ${stockResponse.body}`);
    const stockPayload = stockResponse.json();
    const stock = stockPayload.stock.find((item: { materialId: string; warehouseId: string }) => item.materialId === materialId && item.warehouseId === warehouseId);
    assert(stock, 'G4 stock row missing');
    assert(stock.onHandQty === 6, `Expected net stock=6, got ${stock.onHandQty}`);

    console.log(JSON.stringify({
      sapInventoryV1g4: 'PASS',
      stockQty: stock.onHandQty,
      receipt101: byType.get('101')?.signedQuantity,
      reversal102: byType.get('102')?.signedQuantity,
      issue221: byType.get('221')?.signedQuantity,
      reversal222: byType.get('222')?.signedQuantity,
      exactMatdocVisible: true,
      canonicalDatabase: payload.canonicalDatabase,
      excelRuntimeDependency: payload.excelRuntimeDependency,
    }));
  } finally {
    await withTenant(tenantId, async (tx) => {
      await tx.integrationEntityLink.deleteMany({ where: { tenantId, integrationConnectionId: connectionId } });
      await tx.$executeRaw(Prisma.sql`
        DELETE FROM inventory_movements
        WHERE id IN (${movementIds[0]}::uuid, ${movementIds[1]}::uuid, ${movementIds[2]}::uuid, ${movementIds[3]}::uuid)
      `);
      await tx.integrationConnection.deleteMany({ where: { id: connectionId, tenantId } });
      await tx.$executeRaw(Prisma.sql`DELETE FROM warehouses WHERE id = ${warehouseId}::uuid`);
      await tx.$executeRaw(Prisma.sql`DELETE FROM material_masters WHERE id = ${materialId}::uuid`);
      await tx.nexusObject.deleteMany({ where: { id: materialObjectId, tenantId } });
    });
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
