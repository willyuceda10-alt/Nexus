import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { MemoryIntegrationBinaryStoreV1 } from '../src/integration-binary-store-v1.js';
import { withTenant } from '../src/tenant-transaction.js';

const tenantId = process.env.DEV_TENANT_ID ?? '00000000-0000-4000-8000-000000000002';
const userId = process.env.DEV_USER_ID ?? '00000000-0000-4000-8000-000000000001';
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

async function importWorkbook(
  app: Awaited<ReturnType<typeof buildApp>>,
  connectionId: string,
  fileName: string,
  content: Buffer,
  sourceGeneratedAt: string,
) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/integrations/sap/connections/${connectionId}/imports:auto`,
    headers: {
      'content-type': 'application/octet-stream',
      'x-bridata-file-name': fileName,
      'x-bridata-source-generated-at': sourceGeneratedAt,
    },
    payload: content,
  });
  assert(response.statusCode === 201, `Import ${fileName} failed: ${response.statusCode} ${response.body}`);
  return response.json();
}

async function actualCount(projectId: string): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS n FROM project_actual_costs
      WHERE tenant_id=${tenantId}::uuid AND project_object_id=${projectId}::uuid
    `);
    return Number(rows[0]?.n ?? 0n);
  });
}

async function main() {
  const suffix = Date.now().toString().slice(-7);
  const connectionId = randomUUID();
  const wbs = `CSF-V1D4-${suffix}`;
  const prNumber = `11${suffix}`;
  const poNumber = `46${suffix}`;
  const material = `14${suffix.slice(-6)}`;
  const supplier = `7${suffix.slice(-6)}`;

  const setup = await withTenant(tenantId, async (tx) => {
    const definition = await tx.objectDefinition.findFirst({
      where: { tenantId, key: 'PROJECT' },
      select: { id: true },
    });
    assert(definition, 'PROJECT object definition missing');
    const project = await tx.nexusObject.create({
      data: {
        tenantId,
        workspaceId,
        objectDefinitionId: definition.id,
        objectTypeKey: 'PROJECT',
        title: `SAP Actual V1-D4 ${suffix}`,
        status: 'ACTIVE',
        priority: 'MEDIUM',
        progress: 0,
        ownerId: userId,
        metadata: { source: 'SAP_V1D4_SMOKE' },
      },
      select: { id: true },
    });
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO project_cost_profiles
        (tenant_id, workspace_id, project_object_id, currency, contingency_amount, updated_at)
      VALUES
        (${tenantId}::uuid, ${workspaceId}::uuid, ${project.id}::uuid, 'USD', 0, CURRENT_TIMESTAMP)
    `);
    await tx.integrationConnection.create({
      data: {
        id: connectionId,
        tenantId,
        provider: 'SAP',
        status: 'ACTIVE',
        displayName: 'SAP V1-D4 smoke',
      },
    });
    return { projectId: project.id };
  });
  const projectId = setup.projectId;
  const app = await buildApp({ integrationBinaryStore: new MemoryIntegrationBinaryStoreV1() });

  const mapping = await app.inject({
    method: 'PUT',
    url: `/api/v1/integrations/sap/connections/${connectionId}/wbs-mappings-v1d3`,
    payload: { wbsElement: wbs, projectId },
  });
  assert(mapping.statusCode === 200, `WBS mapping failed: ${mapping.statusCode} ${mapping.body}`);

  await importWorkbook(app, connectionId, 'sap-project-procurement-v1d4.xlsx', await workbook([
    'Solicitud de pedido', 'Pos.solicitud pedido', 'Pedido', 'Posición de pedido', 'Entrada mercancías',
    'Material', 'Cantidad solicitada', 'Valor total', 'Unidad de medida', 'Centro',
  ], [[prNumber, 10, poNumber, 20, 'Sí', material, 10, 100, 'UND', '1000']]), '2026-08-29T10:00:00.000Z');

  await importWorkbook(app, connectionId, 'sap-open-po-v1d4.xlsx', await workbook([
    'Documento compras', 'Por entregar (cantidad)', 'Solicitud de pedido', 'Pos.solicitud pedido', 'Posición',
    'Cantidad de pedido', 'Fecha de entrega', 'Proveedor/Centro suministrador', 'Material',
    'Precio neto', 'Moneda', 'Centro', 'Unidad medida pedido',
  ], [[poNumber, 10, prNumber, 10, 20, 10, '30.08.2026', `${supplier} PROVEEDOR V1D4`, material, 10, 'USD', '1000', 'UND']]), '2026-08-29T10:01:00.000Z');

  await importWorkbook(app, connectionId, 'sap-commitments-v1d4.xlsx', await workbook([
    'Elemento PEP', 'Nº docum.refer.', 'Pos.referencia', 'Tipo de documento de referencia',
    'Tipo de valor', 'Operación', 'Val/Mon.so.CO', 'Moneda del informe', 'Material',
  ], [[wbs, poNumber, 20, 'Pedido', 21, 'RKP1', 100, 'USD', material]]), '2026-08-29T10:02:00.000Z');

  const procurement = await app.inject({
    method: 'POST',
    url: `/api/v1/integrations/sap/connections/${connectionId}/canonical-sync-v1d1`,
    payload: { workspaceId, dryRun: false },
  });
  assert(procurement.statusCode === 200, `V1-D1 prerequisite failed: ${procurement.statusCode} ${procurement.body}`);

  const financialScope = await app.inject({
    method: 'POST',
    url: `/api/v1/integrations/sap/connections/${connectionId}/financial-guard-v1d3`,
    payload: { dryRun: false },
  });
  assert(financialScope.statusCode === 200, `V1-D3 prerequisite failed: ${financialScope.statusCode} ${financialScope.body}`);

  await importWorkbook(app, connectionId, 'sap-movements-v1d4.xlsx', await workbook([
    'Centro', 'Almacén', 'Cantidad', 'Clase de movimiento', 'Fe.contabilización', 'Nº reserva', 'Nº pos.reserva traslado',
    'Material', 'Pedido', 'Posición', 'Elemento PEP', 'Documento material', 'Ejercicio', 'Posición doc.material',
  ], [[
    '1000', '0001', 10, 101, '29.08.2026', 0, 0,
    material, poNumber, 20, wbs, `51${suffix}`, 2026, 1,
  ]]), '2026-08-29T10:03:00.000Z');

  const inventory = await app.inject({
    method: 'POST',
    url: `/api/v1/integrations/sap/connections/${connectionId}/inventory-sync-v1d2`,
    payload: { workspaceId, dryRun: false },
  });
  assert(inventory.statusCode === 200, `V1-D2 prerequisite failed: ${inventory.statusCode} ${inventory.body}`);

  const beforeOverview = await app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}/cost-overview-v2` });
  assert(beforeOverview.statusCode === 200, `Pre-authority cost overview failed: ${beforeOverview.statusCode} ${beforeOverview.body}`);
  const beforeCost = beforeOverview.json();
  assert(beforeCost.summary.actualCost === 100, `Expected receipt-derived actual 100 before DATA PEP, got ${beforeCost.summary.actualCost}`);
  assert(beforeCost.summary.materialActual === 100, 'Expected material receipt to be cost authority before DATA PEP activation');

  const actualHeaders = [
    'Elemento PEP', 'Tipo de valor', 'Clase de documento', 'Fe.contabilización', 'Número de documento',
    'Operación', 'Operación original', 'Val/Mon.so.CO', 'Moneda sociedad CO', 'Material',
    'Clase de coste', 'Denom.clase de coste', 'Texto breve de material', 'Indic.cargo/abono',
    'Sociedad', 'Ejercicio', 'Posición documento', 'Nº docum.refer.',
  ];
  const actualRows = [
    [wbs, 4, 'WE', '29.08.2026', `50${suffix}01`, 'COIN', 'RMWE', 80, 'USD', material, '610100', 'Material SAP', 'Material V1-D4', 'S', '1000', 2026, 1, `51${suffix}`],
    [wbs, 4, 'WE', '29.08.2026', `50${suffix}02`, 'COIN', 'RMWE', 20, 'USD', material, '610100', 'Material SAP', 'Material V1-D4', 'H', '1000', 2026, 1, `51${suffix}`],
  ];
  await importWorkbook(app, connectionId, 'sap-data-pep-v1d4.xlsx', await workbook(actualHeaders, actualRows), '2026-08-29T10:04:00.000Z');

  const beforeActualRows = await actualCount(projectId);
  const dryRun = await app.inject({
    method: 'POST',
    url: `/api/v1/integrations/sap/connections/${connectionId}/actual-cost-sync-v1d4`,
    payload: { dryRun: true },
  });
  assert(dryRun.statusCode === 200, `V1-D4 dry run failed: ${dryRun.statusCode} ${dryRun.body}`);
  const dry = dryRun.json();
  assert(dry.plan.summary.exactFiLines === 2, `Expected two exact FI lines, got ${dry.plan.summary.exactFiLines}`);
  assert(dry.eligibleProjects.includes(projectId), 'Mapped project was not eligible for SAP actual authority');
  assert((await actualCount(projectId)) === beforeActualRows, 'V1-D4 dry-run wrote project actual costs');

  const apply = await app.inject({
    method: 'POST',
    url: `/api/v1/integrations/sap/connections/${connectionId}/actual-cost-sync-v1d4`,
    payload: { dryRun: false },
  });
  assert(apply.statusCode === 200, `V1-D4 apply failed: ${apply.statusCode} ${apply.body}`);
  const applied = apply.json();
  assert(applied.counters.inserted === 2, `Expected two actual inserts, got ${applied.counters.inserted}`);
  assert(applied.counters.projectsActivated === 1, 'Expected SAP DATA PEP authority activation');

  const secondApply = await app.inject({
    method: 'POST',
    url: `/api/v1/integrations/sap/connections/${connectionId}/actual-cost-sync-v1d4`,
    payload: { dryRun: false },
  });
  assert(secondApply.statusCode === 200, `Repeated V1-D4 apply failed: ${secondApply.statusCode} ${secondApply.body}`);
  const second = secondApply.json();
  assert(second.counters.inserted === 0, 'Repeated DATA PEP apply duplicated actuals');
  assert(second.counters.unchanged === 2, `Expected two unchanged actuals, got ${second.counters.unchanged}`);

  const afterOverview = await app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}/cost-overview-v2` });
  assert(afterOverview.statusCode === 200, `Post-authority cost overview failed: ${afterOverview.statusCode} ${afterOverview.body}`);
  const afterCost = afterOverview.json();
  assert(afterCost.actualAuthority === 'SAP_DATA_PEP', `Expected SAP_DATA_PEP authority, got ${afterCost.actualAuthority}`);
  assert(afterCost.summary.materialActual === 0, `Goods receipt actual was double counted: ${afterCost.summary.materialActual}`);
  assert(afterCost.summary.actualCost === 60, `Expected DATA PEP net actual 60, got ${afterCost.summary.actualCost}`);

  const physicalReceiptStillExists = await withTenant(tenantId, async (tx) => {
    const rows = await tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS n
      FROM goods_receipt_lines grl
      JOIN goods_receipts gr ON gr.id=grl.goods_receipt_id
      JOIN purchase_orders po ON po.id=gr.purchase_order_id
      WHERE grl.tenant_id=${tenantId}::uuid AND po.project_object_id=${projectId}::uuid AND gr.status='POSTED'
    `);
    return Number(rows[0]?.n ?? 0n);
  });
  assert(physicalReceiptStillExists === 1, 'V1-D4 removed physical goods receipt evidence');

  const updatedRows = [
    [wbs, 4, 'WE', '29.08.2026', `50${suffix}01`, 'COIN', 'RMWE', 90, 'USD', material, '610100', 'Material SAP', 'Material V1-D4', 'S', '1000', 2026, 1, `51${suffix}`],
    [wbs, 4, 'WE', '29.08.2026', `50${suffix}02`, 'COIN', 'RMWE', 20, 'USD', material, '610100', 'Material SAP', 'Material V1-D4', 'H', '1000', 2026, 1, `51${suffix}`],
  ];
  await importWorkbook(app, connectionId, 'sap-data-pep-v1d4-update.xlsx', await workbook(actualHeaders, updatedRows), '2026-08-29T11:04:00.000Z');
  const updateApply = await app.inject({
    method: 'POST',
    url: `/api/v1/integrations/sap/connections/${connectionId}/actual-cost-sync-v1d4`,
    payload: { dryRun: false },
  });
  assert(updateApply.statusCode === 200, `V1-D4 update failed: ${updateApply.statusCode} ${updateApply.body}`);
  const update = updateApply.json();
  assert(update.counters.updated === 1, `Expected one updated FI actual, got ${update.counters.updated}`);
  assert(update.counters.unchanged === 1, `Expected one unchanged FI actual, got ${update.counters.unchanged}`);
  assert((await actualCount(projectId)) === beforeActualRows + 2, 'Updated snapshot duplicated project actual costs');

  const finalOverview = await app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}/cost-overview-v2` });
  assert(finalOverview.statusCode === 200, `Final cost overview failed: ${finalOverview.statusCode} ${finalOverview.body}`);
  const finalCost = finalOverview.json();
  assert(finalCost.summary.actualCost === 70, `Expected updated DATA PEP net actual 70, got ${finalCost.summary.actualCost}`);
  assert(finalCost.summary.materialActual === 0, 'Goods receipt actual reappeared after DATA PEP update');

  await app.close();
  console.log(JSON.stringify({
    sapActualCostSyncV1d4: 'PASS',
    ownPostgreSqlCanonicalActuals: true,
    wbsProjectMappingRequired: true,
    exactFiIdentitySupported: true,
    legacyAggregateIdentitySupported: true,
    signedSapCreditSupported: true,
    dryRunIsReadOnly: true,
    repeatedApplyIsIdempotent: true,
    latestSnapshotUpdatesExistingActual: true,
    sapDataPepIsActualAuthority: true,
    goodsReceiptRemainsPhysicalEvidence: true,
    goodsReceiptFinancialDoubleCountSuppressed: true,
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
