import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { MemoryIntegrationBinaryStoreV1 } from '../src/integration-binary-store-v1.js';
import { withTenant } from '../src/tenant-transaction.js';

const tenantId = process.env.DEV_TENANT_ID ?? '00000000-0000-4000-8000-000000000002';
const workspaceId = '00000000-0000-4000-8000-000000000003';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function workbook(headers: string[], rows: unknown[][]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('SAP');
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await book.xlsx.writeBuffer());
}

async function importWorkbook(app: Awaited<ReturnType<typeof buildApp>>, connectionId: string, fileName: string, content: Buffer) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/integrations/sap/connections/${connectionId}/imports:auto`,
    headers: {
      'content-type': 'application/octet-stream',
      'x-bridata-file-name': fileName,
    },
    payload: content,
  });
  assert(response.statusCode === 201, `Import ${fileName} failed: ${response.statusCode} ${response.body}`);
  return response.json();
}

async function financialCounts() {
  return withTenant(tenantId, async (tx) => {
    const [commitments, actuals] = await Promise.all([
      tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`SELECT COUNT(*)::bigint n FROM project_commitments WHERE tenant_id=${tenantId}::uuid`),
      tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`SELECT COUNT(*)::bigint n FROM project_actual_costs WHERE tenant_id=${tenantId}::uuid`),
    ]);
    return { commitments: Number(commitments[0]?.n ?? 0n), actuals: Number(actuals[0]?.n ?? 0n) };
  });
}

async function main() {
  const suffix = Date.now().toString().slice(-7);
  const connectionId = randomUUID();
  const prNumber = `10${suffix}`;
  const poNumber = `45${suffix}`;
  const material = `13${suffix.slice(-6)}`;
  const supplier = `9${suffix.slice(-6)}`;

  await withTenant(tenantId, async (tx) => {
    await tx.integrationConnection.create({
      data: { id: connectionId, tenantId, provider: 'SAP', status: 'ACTIVE', displayName: 'SAP V1-D2 smoke' },
    });
  });

  const app = await buildApp({ integrationBinaryStore: new MemoryIntegrationBinaryStoreV1() });

  await importWorkbook(app, connectionId, 'sap-project-procurement-v1d2.xlsx', await workbook([
    'Solicitud de pedido', 'Pos.solicitud pedido', 'Pedido', 'Posición de pedido', 'Entrada mercancías',
    'Material', 'Cantidad solicitada', 'Valor total', 'Unidad de medida', 'Centro',
  ], [[prNumber, 10, poNumber, 20, 'Sí', material, 12, 120, 'UND', '1000']]));

  await importWorkbook(app, connectionId, 'sap-open-purchase-orders-v1d2.xlsx', await workbook([
    'Documento compras', 'Por entregar (cantidad)', 'Solicitud de pedido', 'Pos.solicitud pedido', 'Posición',
    'Cantidad de pedido', 'Fecha de entrega', 'Proveedor/Centro suministrador', 'Material', 'Precio neto', 'Moneda', 'Centro', 'Unidad medida pedido',
  ], [[poNumber, 12, prNumber, 10, 20, 12, '30.08.2026', `${supplier} PROVEEDOR V1D2`, material, 10, 'USD', '1000', 'UND']]));

  const canonicalProcurement = await app.inject({
    method: 'POST',
    url: `/api/v1/integrations/sap/connections/${connectionId}/canonical-sync-v1d1`,
    payload: { workspaceId, dryRun: false },
  });
  assert(canonicalProcurement.statusCode === 200, `V1-D1 prerequisite failed: ${canonicalProcurement.statusCode} ${canonicalProcurement.body}`);

  const movementHeaders = [
    'Centro', 'Almacén', 'Cantidad', 'Clase de movimiento', 'Fe.contabilización', 'Nº reserva', 'Nº pos.reserva traslado',
    'Material', 'Pedido', 'Posición', 'Elemento PEP', 'Documento material', 'Ejercicio', 'Posición doc.material',
  ];
  const movementRows = [
    ['1000', '0001', 8, 101, '29.08.2026', 0, 0, material, poNumber, 20, 'CSF-SMOKE', '5000000001', 2026, 1],
    ['1000', '0001', 3, 221, '29.08.2026', 0, 0, material, '', '', 'CSF-SMOKE', '5000000002', 2026, 1],
    ['1000', '0001', 1, 222, '29.08.2026', 0, 0, material, '', '', 'CSF-SMOKE', '5000000003', 2026, 1],
    ['1000', '0001', 2, 102, '29.08.2026', 0, 0, material, poNumber, 20, 'CSF-SMOKE', '5000000004', 2026, 1],
    ['1000', '0001', 1, 101, '29.08.2026', 0, 0, material, poNumber, 20, 'CSF-SMOKE', '', '', ''],
  ];
  const importedMovements = await importWorkbook(
    app,
    connectionId,
    'sap-material-movements-with-matdoc-v1d2.xlsx',
    await workbook(movementHeaders, movementRows),
  );
  assert(importedMovements.detection.sourceKey === 'SAP_MATERIAL_MOVEMENTS', 'Movement source was not structurally detected');

  const beforeFinancial = await financialCounts();
  const beforeInventory = await withTenant(tenantId, async (tx) => tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint n FROM inventory_movements WHERE tenant_id=${tenantId}::uuid AND workspace_id=${workspaceId}::uuid
  `));

  const dryRun = await app.inject({
    method: 'POST',
    url: `/api/v1/integrations/sap/connections/${connectionId}/inventory-sync-v1d2`,
    payload: { workspaceId, dryRun: true },
  });
  assert(dryRun.statusCode === 200, `V1-D2 dry run failed: ${dryRun.statusCode} ${dryRun.body}`);
  const dryPayload = dryRun.json();
  assert(dryPayload.summary.movementRecords === 5, 'Expected five movement records');
  assert(dryPayload.summary.exactIdentityCandidates === 4, 'Expected four exact MATDOC candidates');
  assert(dryPayload.summary.blocked === 1, 'Expected legacy movement without MATDOC to stay blocked');

  const afterDryInventory = await withTenant(tenantId, async (tx) => tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint n FROM inventory_movements WHERE tenant_id=${tenantId}::uuid AND workspace_id=${workspaceId}::uuid
  `));
  assert(Number(afterDryInventory[0]?.n ?? 0n) === Number(beforeInventory[0]?.n ?? 0n), 'Dry run modified inventory');

  const apply = await app.inject({
    method: 'POST',
    url: `/api/v1/integrations/sap/connections/${connectionId}/inventory-sync-v1d2`,
    payload: { workspaceId, dryRun: false },
  });
  assert(apply.statusCode === 200, `V1-D2 apply failed: ${apply.statusCode} ${apply.body}`);
  const applied = apply.json();
  assert(applied.inventoryCanonicalWriteEnabled === true, 'Inventory canonical writes were not enabled');
  assert(applied.financialCanonicalWriteEnabled === false, 'Financial writes must remain disabled');
  assert(applied.counters.insertedMovements === 4, `Expected four inventory movements, got ${applied.counters.insertedMovements}`);
  assert(applied.counters.goodsReceiptsCreated === 1, 'Expected one 101 goods receipt');
  assert(applied.counters.blockedMovements === 1, `Expected one blocked legacy movement, got ${applied.counters.blockedMovements}`);

  const canonical = await withTenant(tenantId, async (tx) => {
    const poLink = await tx.$queryRaw<Array<{ canonical_entity_id: string }>>(Prisma.sql`
      SELECT canonical_entity_id FROM integration_entity_links
      WHERE tenant_id=${tenantId}::uuid AND integration_connection_id=${connectionId}::uuid
        AND external_entity_type='SAP_PURCHASE_ORDER_LINE' AND external_key=${`PO:${poNumber}:00020`}
    `);
    assert(poLink[0], 'Canonical PO line link missing');
    const poLine = await tx.$queryRaw<Array<{ received_qty: Prisma.Decimal | number | string }>>(Prisma.sql`
      SELECT received_qty FROM purchase_order_lines
      WHERE tenant_id=${tenantId}::uuid AND id=${poLink[0]!.canonical_entity_id}::uuid
    `);
    const materialRow = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM material_masters WHERE tenant_id=${tenantId}::uuid AND workspace_id=${workspaceId}::uuid AND code=${material}
    `);
    const warehouse = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM warehouses WHERE tenant_id=${tenantId}::uuid AND workspace_id=${workspaceId}::uuid AND code='1000:0001'
    `);
    assert(materialRow[0] && warehouse[0], 'Material or warehouse missing');
    const balance = await tx.$queryRaw<Array<{ qty: Prisma.Decimal | number | string }>>(Prisma.sql`
      SELECT COALESCE(SUM(CASE WHEN movement_type IN ('RECEIPT','TRANSFER_IN','ADJUSTMENT_IN') THEN quantity ELSE -quantity END),0) qty
      FROM inventory_movements
      WHERE tenant_id=${tenantId}::uuid AND workspace_id=${workspaceId}::uuid
        AND warehouse_id=${warehouse[0]!.id}::uuid AND material_id=${materialRow[0]!.id}::uuid
    `);
    const links = await tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint n FROM integration_entity_links
      WHERE tenant_id=${tenantId}::uuid AND integration_connection_id=${connectionId}::uuid
        AND external_entity_type='SAP_MATERIAL_DOCUMENT_ITEM'
    `);
    const receipts = await tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint n FROM goods_receipts
      WHERE tenant_id=${tenantId}::uuid AND workspace_id=${workspaceId}::uuid AND number LIKE 'SAP-2026-5000000001-%'
    `);
    return {
      receivedQty: Number(poLine[0]?.received_qty ?? 0),
      balance: Number(balance[0]?.qty ?? 0),
      links: Number(links[0]?.n ?? 0n),
      receipts: Number(receipts[0]?.n ?? 0n),
    };
  });
  assert(canonical.receivedQty === 6, `Expected PO received qty 6, got ${canonical.receivedQty}`);
  assert(canonical.balance === 4, `Expected physical balance 4, got ${canonical.balance}`);
  assert(canonical.links === 4, `Expected four MATDOC links, got ${canonical.links}`);
  assert(canonical.receipts === 1, `Expected one goods receipt, got ${canonical.receipts}`);

  const secondApply = await app.inject({
    method: 'POST',
    url: `/api/v1/integrations/sap/connections/${connectionId}/inventory-sync-v1d2`,
    payload: { workspaceId, dryRun: false },
  });
  assert(secondApply.statusCode === 200, `Second V1-D2 apply failed: ${secondApply.statusCode} ${secondApply.body}`);
  const second = secondApply.json();
  assert(second.counters.insertedMovements === 0, 'Repeated apply duplicated movements');
  assert(second.counters.unchangedMovements === 4, `Expected four unchanged movements, got ${second.counters.unchangedMovements}`);

  const afterFinancial = await financialCounts();
  assert(JSON.stringify(beforeFinancial) === JSON.stringify(afterFinancial), 'V1-D2 modified financial tables');

  await app.close();
  console.log(JSON.stringify({
    sapInventorySyncV1d2: 'PASS',
    exactMaterialDocumentIdentity: true,
    dryRunIsReadOnly: true,
    receipt101CreatesGoodsReceiptAndInventory: true,
    reversal102ReducesReceiptAndStock: true,
    issue221ReducesStock: true,
    reversal222RestoresIssuedStock: true,
    repeatedApplyIsIdempotent: true,
    legacyMovementWithoutMatdocBlocked: true,
    financialWritesBlocked: true,
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
