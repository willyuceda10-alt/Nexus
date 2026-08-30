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
  const projectId = randomUUID();
  const materialObjectId = randomUUID();
  const materialId = randomUUID();
  const warehouseId = randomUUID();
  const supplierId = randomUUID();
  const purchaseOrderId = randomUUID();
  const purchaseOrderLineId = randomUUID();
  const actualId = randomUUID();
  const prePoCommitmentId = randomUUID();
  const connectionId = randomUUID();
  const purchaseOrderNumber = `45${suffix.slice(-6)}`;
  const materialCode = `MAT-G5-${suffix}`;
  const wbsElement = `WBS-G5-${suffix}`;
  const accountingDocument = `19${suffix.slice(-8)}`;
  const app = await buildApp();
  await app.ready();

  try {
    await withTenant(tenantId, async (tx) => {
      const [projectDefinition, materialDefinition] = await Promise.all([
        tx.objectDefinition.findFirst({ where: { tenantId, key: 'PROJECT' }, select: { id: true } }),
        tx.objectDefinition.findFirst({ where: { tenantId, key: 'MATERIAL' }, select: { id: true } }),
      ]);
      assert(projectDefinition, 'PROJECT object definition missing');
      assert(materialDefinition, 'MATERIAL object definition missing');

      const uomRows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM unit_of_measures
        WHERE tenant_id = ${tenantId}::uuid AND is_active = true
        ORDER BY code LIMIT 1
      `);
      assert(uomRows[0], 'Seed UOM missing');
      const uomId = uomRows[0].id;

      const currencyRows = await tx.$queryRaw<Array<{ currency: string }>>(Prisma.sql`
        SELECT COALESCE(NULLIF(metadata->>'currency', ''), 'USD') AS currency
        FROM tenants WHERE id = ${tenantId}::uuid
      `);
      const currency = currencyRows[0]?.currency ?? 'USD';

      await tx.nexusObject.create({
        data: {
          id: projectId,
          tenantId,
          workspaceId,
          objectDefinitionId: projectDefinition.id,
          objectTypeKey: 'PROJECT',
          title: `Proyecto SAP G5 ${suffix}`,
          status: 'ACTIVE',
          priority: 'MEDIUM',
          progress: 0,
          ownerId: userId,
          metadata: { source: 'SAP_G5_SMOKE' },
        },
      });
      await tx.nexusObject.create({
        data: {
          id: materialObjectId,
          tenantId,
          workspaceId,
          objectDefinitionId: materialDefinition.id,
          objectTypeKey: 'MATERIAL',
          title: `Material SAP G5 ${suffix}`,
          status: 'ACTIVE',
          priority: 'MEDIUM',
          progress: 0,
          ownerId: userId,
          metadata: { source: 'SAP_G5_SMOKE' },
        },
      });

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO project_cost_profiles
          (tenant_id, workspace_id, project_object_id, currency, contingency_amount, updated_at)
        VALUES
          (${tenantId}::uuid, ${workspaceId}::uuid, ${projectId}::uuid, ${currency}, 0, CURRENT_TIMESTAMP)
      `);

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO material_masters
          (id, tenant_id, workspace_id, material_object_id, code, base_uom_id, unit_cost, currency, is_active)
        VALUES
          (${materialId}::uuid, ${tenantId}::uuid, ${workspaceId}::uuid, ${materialObjectId}::uuid,
           ${materialCode}, ${uomId}::uuid, 10, ${currency}, true)
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO warehouses (id, tenant_id, workspace_id, code, name, is_active)
        VALUES (${warehouseId}::uuid, ${tenantId}::uuid, ${workspaceId}::uuid,
                ${`WG5${suffix}`}, ${`Almacén G5 ${suffix}`}, true)
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO suppliers (id, tenant_id, code, name, is_active)
        VALUES (${supplierId}::uuid, ${tenantId}::uuid, ${`SG5${suffix}`}, ${`Proveedor G5 ${suffix}`}, true)
      `);

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO purchase_orders
          (id, tenant_id, workspace_id, project_object_id, supplier_id, number, status,
           order_date, expected_date, currency, notes)
        VALUES (${purchaseOrderId}::uuid, ${tenantId}::uuid, ${workspaceId}::uuid, ${projectId}::uuid,
                ${supplierId}::uuid, ${purchaseOrderNumber}, 'PARTIAL', CURRENT_DATE,
                CURRENT_DATE + 3, ${currency}, 'G5 smoke')
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO purchase_order_lines
          (id, tenant_id, purchase_order_id, material_id, uom_id, quantity, received_qty, unit_cost, expected_date)
        VALUES (${purchaseOrderLineId}::uuid, ${tenantId}::uuid, ${purchaseOrderId}::uuid,
                ${materialId}::uuid, ${uomId}::uuid, 10, 6, 10, CURRENT_DATE + 3)
      `);

      const receiptRows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        INSERT INTO goods_receipts
          (tenant_id, workspace_id, warehouse_id, purchase_order_id, number, status,
           received_at, received_by_user_id, notes)
        VALUES
          (${tenantId}::uuid, ${workspaceId}::uuid, ${warehouseId}::uuid, ${purchaseOrderId}::uuid,
           ${`GR-G5-${suffix}`}, 'POSTED', CURRENT_TIMESTAMP, ${userId}::uuid, 'G5 physical receipt')
        RETURNING id
      `);
      const goodsReceiptId = receiptRows[0]!.id;
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO goods_receipt_lines
          (tenant_id, goods_receipt_id, purchase_order_line_id, material_id, uom_id, quantity, unit_cost)
        VALUES
          (${tenantId}::uuid, ${goodsReceiptId}::uuid, ${purchaseOrderLineId}::uuid,
           ${materialId}::uuid, ${uomId}::uuid, 6, 10)
      `);

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO project_actual_costs
          (id, tenant_id, workspace_id, project_object_id, work_item_object_id, cost_code_id,
           material_id, description, amount, currency, source_type, external_reference,
           occurred_at, notes, created_by_user_id)
        VALUES
          (${actualId}::uuid, ${tenantId}::uuid, ${workspaceId}::uuid, ${projectId}::uuid,
           NULL, NULL, ${materialId}::uuid, 'Costo DATA PEP G5', 100, ${currency}, 'SAP_IMPORT',
           ${`SAP_DATA_PEP:FI:${accountingDocument}:001`}, CURRENT_DATE,
           'DATA PEP EXACT_FI_LINE', ${userId}::uuid)
      `);

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO project_commitments
          (id, tenant_id, workspace_id, project_object_id, work_item_object_id,
           cost_code_id, supplier_id, description, amount, released_amount,
           currency, status, source_type, source_reference, committed_at, notes, updated_at)
        VALUES
          (${prePoCommitmentId}::uuid, ${tenantId}::uuid, ${workspaceId}::uuid, ${projectId}::uuid,
           NULL, NULL, NULL, 'SolP SAP G5', 30, 0, ${currency}, 'OPEN', 'SAP_IMPORT',
           ${`PR:10${suffix.slice(-6)}:00010`}, CURRENT_TIMESTAMP,
           'Compromiso pre-Pedido SAP G5', CURRENT_TIMESTAMP)
      `);

      await tx.integrationConnection.create({
        data: { id: connectionId, tenantId, provider: 'SAP', status: 'ACTIVE', displayName: `SAP G5 ${suffix}` },
      });
      await tx.integrationEntityLink.createMany({
        data: [
          {
            tenantId,
            integrationConnectionId: connectionId,
            sourceRecordId: null,
            externalEntityType: 'SAP_ACTUAL_COST_AUTHORITY',
            externalKey: `PROJECT:${projectId}`,
            canonicalEntityType: 'PROJECT_OBJECT',
            canonicalEntityId: projectId,
            metadata: {
              authority: 'SAP_DATA_PEP',
              version: 'v1d4',
              materialReceiptActualsSuppressed: true,
              activationPolicy: 'PROJECT_ALL_OR_NOTHING',
            },
          },
          {
            tenantId,
            integrationConnectionId: connectionId,
            sourceRecordId: null,
            externalEntityType: 'SAP_ACTUAL_COST_PROJECTION',
            externalKey: `FI:${accountingDocument}:001`,
            canonicalEntityType: 'PROJECT_ACTUAL_COST',
            canonicalEntityId: actualId,
            metadata: {
              source: 'SAP_DATA_PEP',
              version: 'v1d4',
              identityMode: 'EXACT_FI_LINE',
              wbsElement,
              accountingDocument,
              companyCode: '1000',
              fiscalYear: '2026',
              accountingDocumentItem: '001',
            },
          },
          {
            tenantId,
            integrationConnectionId: connectionId,
            sourceRecordId: null,
            externalEntityType: 'SAP_PRE_PO_COMMITMENT',
            externalKey: `PR:10${suffix.slice(-6)}:00010`,
            canonicalEntityType: 'PROJECT_COMMITMENT',
            canonicalEntityId: prePoCommitmentId,
            metadata: { source: 'SAP', canonicalSyncVersion: 'v1d3', wbsElement, projectId, representation: 'PRE_PO_ONLY' },
          },
          {
            tenantId,
            integrationConnectionId: connectionId,
            sourceRecordId: null,
            externalEntityType: 'SAP_PURCHASE_ORDER_LINE',
            externalKey: `PO:${purchaseOrderNumber}:00020`,
            canonicalEntityType: 'PURCHASE_ORDER_LINE',
            canonicalEntityId: purchaseOrderLineId,
            metadata: { source: 'SAP', canonicalSyncVersion: 'v1d1' },
          },
        ],
      });
    });

    const g5Response = await app.inject({
      method: 'GET',
      url: `/api/v1/cost-engine-v2/sap-financial-v1g5?projectId=${projectId}`,
    });
    assert(g5Response.statusCode === 200, `G5 financial view failed: ${g5Response.statusCode} ${g5Response.body}`);
    const g5 = g5Response.json();
    assert(g5.version === 'v1g5', 'Unexpected G5 version');
    assert(g5.canonicalDatabase === 'BRIDATA_POSTGRESQL', 'Canonical PostgreSQL boundary missing');
    assert(g5.excelRuntimeDependency === false, 'Excel must not be runtime dependency');
    assert(g5.actualAuthority === 'SAP_DATA_PEP', 'DATA PEP authority missing');
    assert(g5.policies.materialReceiptActualsSuppressed === true, 'Goods receipt actual suppression missing');
    assert(g5.policies.prePoClosedWhenPurchaseOrderAppears === true, 'Pre-PO transition policy missing');
    assert(g5.summary.sapActualCost === 100, `Expected DATA PEP actual=100, got ${g5.summary.sapActualCost}`);
    assert(g5.summary.sapPrePoCommitment === 30, `Expected pre-PO=30, got ${g5.summary.sapPrePoCommitment}`);
    assert(g5.summary.sapPurchaseOrderCommitment === 40, `Expected PO outstanding=40, got ${g5.summary.sapPurchaseOrderCommitment}`);
    assert(g5.summary.sapOpenCommitment === 70, `Expected SAP commitment=70, got ${g5.summary.sapOpenCommitment}`);
    assert(g5.summary.sapSpentAndCommitted === 170, `Expected spent+committed=170, got ${g5.summary.sapSpentAndCommitted}`);
    assert(g5.actuals[0]?.accountingDocument === accountingDocument, 'Accounting document trace missing');
    const poCommitment = g5.commitments.find((row: { kind: string }) => row.kind === 'PURCHASE_ORDER');
    assert(poCommitment?.purchaseOrderPosition === '00020', 'SAP PO position trace missing');

    const overviewResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/cost-overview-v2`,
    });
    assert(overviewResponse.statusCode === 200, `Cost overview failed: ${overviewResponse.statusCode} ${overviewResponse.body}`);
    const overview = overviewResponse.json();
    assert(overview.actualAuthority === 'SAP_DATA_PEP', 'Cost Engine authority must be DATA PEP');
    assert(overview.summary.actualCost === 100, `Goods receipt must not duplicate actual; got ${overview.summary.actualCost}`);
    assert(overview.summary.materialActual === 0, `Material receipt actual must be suppressed; got ${overview.summary.materialActual}`);
    assert(overview.summary.openCommitment === 70, `Expected canonical open commitment=70, got ${overview.summary.openCommitment}`);

    console.log(JSON.stringify({
      sapFinancialV1g5: 'PASS',
      dataPepActual: g5.summary.sapActualCost,
      prePoCommitment: g5.summary.sapPrePoCommitment,
      purchaseOrderCommitment: g5.summary.sapPurchaseOrderCommitment,
      sapOpenCommitment: g5.summary.sapOpenCommitment,
      physicalReceiptNotDoubleCounted: overview.summary.materialActual === 0,
      canonicalActualCost: overview.summary.actualCost,
      actualAuthority: overview.actualAuthority,
      canonicalDatabase: g5.canonicalDatabase,
      excelRuntimeDependency: g5.excelRuntimeDependency,
    }));
  } finally {
    await withTenant(tenantId, async (tx) => {
      await tx.integrationEntityLink.deleteMany({ where: { tenantId, integrationConnectionId: connectionId } });
      await tx.$executeRaw(Prisma.sql`DELETE FROM goods_receipt_lines WHERE purchase_order_line_id = ${purchaseOrderLineId}::uuid`);
      await tx.$executeRaw(Prisma.sql`DELETE FROM goods_receipts WHERE purchase_order_id = ${purchaseOrderId}::uuid`);
      await tx.$executeRaw(Prisma.sql`DELETE FROM project_commitments WHERE id = ${prePoCommitmentId}::uuid`);
      await tx.$executeRaw(Prisma.sql`DELETE FROM project_actual_costs WHERE id = ${actualId}::uuid`);
      await tx.$executeRaw(Prisma.sql`DELETE FROM project_cost_profiles WHERE project_object_id = ${projectId}::uuid AND tenant_id = ${tenantId}::uuid`);
      await tx.$executeRaw(Prisma.sql`DELETE FROM purchase_order_lines WHERE id = ${purchaseOrderLineId}::uuid`);
      await tx.$executeRaw(Prisma.sql`DELETE FROM purchase_orders WHERE id = ${purchaseOrderId}::uuid`);
      await tx.$executeRaw(Prisma.sql`DELETE FROM suppliers WHERE id = ${supplierId}::uuid`);
      await tx.$executeRaw(Prisma.sql`DELETE FROM warehouses WHERE id = ${warehouseId}::uuid`);
      await tx.$executeRaw(Prisma.sql`DELETE FROM material_masters WHERE id = ${materialId}::uuid`);
      await tx.nexusObject.deleteMany({ where: { id: materialObjectId, tenantId } });
      await tx.nexusObject.deleteMany({ where: { id: projectId, tenantId } });
      await tx.integrationConnection.deleteMany({ where: { id: connectionId, tenantId } });
    });
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
