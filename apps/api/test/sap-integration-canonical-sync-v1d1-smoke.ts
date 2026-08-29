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
  const value = await book.xlsx.writeBuffer();
  return Buffer.from(value);
}

async function counts() {
  return withTenant(tenantId, async (tx) => {
    const [pr, prl, po, pol, materials, suppliers, movements, commitments, actuals] = await Promise.all([
      tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`SELECT COUNT(*)::bigint n FROM purchase_requisitions WHERE tenant_id=${tenantId}::uuid AND workspace_id=${workspaceId}::uuid`),
      tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`SELECT COUNT(*)::bigint n FROM purchase_requisition_lines WHERE tenant_id=${tenantId}::uuid`),
      tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`SELECT COUNT(*)::bigint n FROM purchase_orders WHERE tenant_id=${tenantId}::uuid AND workspace_id=${workspaceId}::uuid`),
      tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`SELECT COUNT(*)::bigint n FROM purchase_order_lines WHERE tenant_id=${tenantId}::uuid`),
      tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`SELECT COUNT(*)::bigint n FROM material_masters WHERE tenant_id=${tenantId}::uuid AND workspace_id=${workspaceId}::uuid`),
      tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`SELECT COUNT(*)::bigint n FROM suppliers WHERE tenant_id=${tenantId}::uuid`),
      tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`SELECT COUNT(*)::bigint n FROM inventory_movements WHERE tenant_id=${tenantId}::uuid`),
      tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`SELECT COUNT(*)::bigint n FROM project_commitments WHERE tenant_id=${tenantId}::uuid`),
      tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`SELECT COUNT(*)::bigint n FROM project_actual_costs WHERE tenant_id=${tenantId}::uuid`),
    ]);
    return {
      pr: Number(pr[0]?.n ?? 0n), prl: Number(prl[0]?.n ?? 0n),
      po: Number(po[0]?.n ?? 0n), pol: Number(pol[0]?.n ?? 0n),
      materials: Number(materials[0]?.n ?? 0n), suppliers: Number(suppliers[0]?.n ?? 0n),
      movements: Number(movements[0]?.n ?? 0n), commitments: Number(commitments[0]?.n ?? 0n), actuals: Number(actuals[0]?.n ?? 0n),
    };
  });
}

async function main() {
  const connectionId = randomUUID();
  const prNumber = `10${Date.now().toString().slice(-8)}`;
  const poNumber = `45${Date.now().toString().slice(-8)}`;
  const material = `13${Date.now().toString().slice(-6)}`;
  const supplier = `9${Date.now().toString().slice(-8)}`;

  await withTenant(tenantId, async (tx) => {
    await tx.integrationConnection.create({
      data: { id: connectionId, tenantId, provider: 'SAP', status: 'ACTIVE', displayName: 'SAP V1-D1 smoke' },
    });
  });

  const app = await buildApp({ integrationBinaryStore: new MemoryIntegrationBinaryStoreV1() });

  const projectProcurement = await workbook([
    'Solicitud de pedido', 'Pos.solicitud pedido', 'Pedido', 'Posición de pedido', 'Entrada mercancías',
    'Material', 'Cantidad solicitada', 'Valor total', 'Unidad de medida', 'Centro',
  ], [[prNumber, 10, poNumber, 20, 'Sí', material, 12, 120, 'UND', '1000']]);

  const openOrders = await workbook([
    'Documento compras', 'Por entregar (cantidad)', 'Solicitud de pedido', 'Pos.solicitud pedido', 'Posición',
    'Cantidad de pedido', 'Fecha de entrega', 'Proveedor/Centro suministrador', 'Material', 'Precio neto', 'Moneda', 'Centro', 'Unidad medida pedido',
  ], [[poNumber, 4, prNumber, 10, 20, 12, '30.08.2026', `${supplier} PROVEEDOR V1D1`, material, 10, 'USD', '1000', 'UND']]);

  const movements = await workbook([
    'Centro', 'Almacén', 'Cantidad', 'Clase de movimiento', 'Fe.contabilización', 'Nº reserva', 'Nº pos.reserva traslado',
    'Material', 'Pedido', 'Posición', 'Elemento PEP',
  ], [['1000', '0001', 8, 101, '29.08.2026', 0, 0, material, poNumber, 20, 'CSF-SMOKE']]);

  for (const [name, content] of [['p.xlsx', projectProcurement], ['o.xlsx', openOrders], ['m.xlsx', movements]] as const) {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/integrations/sap/connections/${connectionId}/imports:auto`,
      headers: { 'content-type': 'application/octet-stream', 'x-bridata-file-name': name },
      payload: content,
    });
    assert(response.statusCode === 201, `Import ${name} failed: ${response.statusCode} ${response.body}`);
  }

  const before = await counts();
  const dryRun = await app.inject({
    method: 'POST', url: `/api/v1/integrations/sap/connections/${connectionId}/canonical-sync-v1d1`,
    payload: { workspaceId, dryRun: true },
  });
  assert(dryRun.statusCode === 200, `Dry run failed: ${dryRun.statusCode} ${dryRun.body}`);
  const afterDryRun = await counts();
  assert(JSON.stringify(before) === JSON.stringify(afterDryRun), 'Dry run modified canonical tables');

  const apply = await app.inject({
    method: 'POST', url: `/api/v1/integrations/sap/connections/${connectionId}/canonical-sync-v1d1`,
    payload: { workspaceId, dryRun: false },
  });
  assert(apply.statusCode === 200, `Apply failed: ${apply.statusCode} ${apply.body}`);
  const applied = apply.json();
  assert(applied.procurementCanonicalWriteEnabled === true, 'Procurement writes were not enabled on apply');
  assert(applied.inventoryCanonicalWriteEnabled === false, 'Inventory writes must remain disabled');
  assert(applied.financialCanonicalWriteEnabled === false, 'Financial writes must remain disabled');
  assert(applied.summary.blockedMovements === 1, 'Movement without material document identity was not blocked');

  const afterFirst = await counts();
  assert(afterFirst.pr === before.pr + 1, 'Expected one canonical requisition');
  assert(afterFirst.prl === before.prl + 1, 'Expected one canonical requisition line');
  assert(afterFirst.po === before.po + 1, 'Expected one canonical purchase order');
  assert(afterFirst.pol === before.pol + 1, 'Expected one canonical purchase order line');
  assert(afterFirst.materials === before.materials + 1, 'Expected one canonical material');
  assert(afterFirst.suppliers === before.suppliers + 1, 'Expected one canonical supplier');
  assert(afterFirst.movements === before.movements, 'V1-D1 must not create inventory movements');
  assert(afterFirst.commitments === before.commitments, 'V1-D1 must not create commitments');
  assert(afterFirst.actuals === before.actuals, 'V1-D1 must not create actual costs');

  const second = await app.inject({
    method: 'POST', url: `/api/v1/integrations/sap/connections/${connectionId}/canonical-sync-v1d1`,
    payload: { workspaceId, dryRun: false },
  });
  assert(second.statusCode === 200, `Second apply failed: ${second.statusCode} ${second.body}`);
  const afterSecond = await counts();
  assert(afterSecond.pr === afterFirst.pr && afterSecond.prl === afterFirst.prl, 'Requisition sync duplicated canonical records');
  assert(afterSecond.po === afterFirst.po && afterSecond.pol === afterFirst.pol, 'Purchase-order sync duplicated canonical records');
  assert(afterSecond.materials === afterFirst.materials && afterSecond.suppliers === afterFirst.suppliers, 'Master sync duplicated records');

  const links = await withTenant(tenantId, async (tx) => tx.$queryRaw<Array<{ external_entity_type: string; external_key: string }>>(Prisma.sql`
    SELECT external_entity_type, external_key FROM integration_entity_links
    WHERE tenant_id=${tenantId}::uuid AND integration_connection_id=${connectionId}::uuid
      AND external_entity_type IN ('SAP_PURCHASE_REQUISITION_LINE','SAP_PURCHASE_ORDER_LINE')
  `));
  assert(links.length === 2, `Expected two external canonical links, got ${links.length}`);

  await app.close();
  console.log(JSON.stringify({
    sapCanonicalSyncV1d1: 'PASS',
    dryRunIsReadOnly: true,
    ownPostgreSqlOperationalDatabase: true,
    requisitionUpsert: true,
    purchaseOrderUpsert: true,
    materialAndSupplierMasterUpsert: true,
    externalIdentityLinks: true,
    repeatedApplyIsIdempotent: true,
    inventoryBlockedWithoutMaterialDocumentIdentity: true,
    financialWritesStillBlocked: true,
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
