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

async function projectFinancialCounts(projectId: string) {
  return withTenant(tenantId, async (tx) => {
    const [commitments, actuals] = await Promise.all([
      tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS n FROM project_commitments
        WHERE tenant_id=${tenantId}::uuid AND project_object_id=${projectId}::uuid
      `),
      tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS n FROM project_actual_costs
        WHERE tenant_id=${tenantId}::uuid AND project_object_id=${projectId}::uuid
      `),
    ]);
    return {
      commitments: Number(commitments[0]?.n ?? 0n),
      actuals: Number(actuals[0]?.n ?? 0n),
    };
  });
}

async function main() {
  const suffix = Date.now().toString().slice(-7);
  const connectionId = randomUUID();
  const wbs = `CSF-V1D3-${suffix}`;
  const prNumber = `10${suffix}`;
  const poNumber = `45${suffix}`;
  const material = `13${suffix.slice(-6)}`;
  const supplier = `8${suffix.slice(-6)}`;

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
        title: `SAP Financial V1-D3 ${suffix}`,
        status: 'ACTIVE',
        priority: 'MEDIUM',
        progress: 0,
        ownerId: userId,
        metadata: { source: 'SAP_V1D3_SMOKE' },
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
        displayName: 'SAP V1-D3 smoke',
      },
    });
    return { projectId: project.id };
  });
  const projectId = setup.projectId;

  const app = await buildApp({ integrationBinaryStore: new MemoryIntegrationBinaryStoreV1() });

  const mapResponse = await app.inject({
    method: 'PUT',
    url: `/api/v1/integrations/sap/connections/${connectionId}/wbs-mappings-v1d3`,
    payload: { wbsElement: wbs, projectId },
  });
  assert(mapResponse.statusCode === 200, `WBS mapping failed: ${mapResponse.statusCode} ${mapResponse.body}`);

  await importWorkbook(app, connectionId, 'sap-project-procurement-pre-po-v1d3.xlsx', await workbook([
    'Solicitud de pedido', 'Pos.solicitud pedido', 'Pedido', 'Posición de pedido', 'Entrada mercancías',
    'Material', 'Cantidad solicitada', 'Valor total', 'Unidad de medida', 'Centro',
  ], [[prNumber, 10, '', '', 'Sí', material, 10, 100, 'UND', '1000']]), '2026-08-28T12:00:00.000Z');

  await importWorkbook(app, connectionId, 'sap-commitments-pre-po-v1d3.xlsx', await workbook([
    'Elemento PEP', 'Nº docum.refer.', 'Pos.referencia', 'Tipo de documento de referencia',
    'Tipo de valor', 'Operación', 'Val/Mon.so.CO', 'Moneda del informe', 'Material',
    'Texto breve de material', 'Fecha de cargo',
  ], [[wbs, prNumber, 10, 'Solicitud de pedido', 21, 'RKP1', 100, 'USD', material, 'Material V1-D3', '28.08.2026']]), '2026-08-28T12:01:00.000Z');

  await importWorkbook(app, connectionId, 'sap-data-pep-v1d3.xlsx', await workbook([
    'Elemento PEP', 'Tipo de valor', 'Clase de documento', 'Fe.contabilización',
    'Número de documento', 'Operación', 'Operación original', 'Val/Mon.so.CO',
    'Moneda sociedad CO', 'Material', 'Cantidad total reg.',
  ], [[wbs, 4, 'WE', '28.08.2026', `50${suffix}`, 'COIN', 'RMWE', 50, 'USD', material, 5]]), '2026-08-28T12:02:00.000Z');

  const before = await projectFinancialCounts(projectId);
  const dryRun = await app.inject({
    method: 'POST',
    url: `/api/v1/integrations/sap/connections/${connectionId}/financial-guard-v1d3`,
    payload: { dryRun: true },
  });
  assert(dryRun.statusCode === 200, `V1-D3 dry-run failed: ${dryRun.statusCode} ${dryRun.body}`);
  const dryPayload = dryRun.json();
  assert(dryPayload.summary.prePoCommitments === 1, 'Expected one pre-PO commitment candidate');
  assert(dryPayload.summary.actualRecordsDeferred === 1, 'Expected DATA PEP actual to stay deferred');
  assert(JSON.stringify(await projectFinancialCounts(projectId)) === JSON.stringify(before), 'V1-D3 dry-run modified financial tables');

  const firstApply = await app.inject({
    method: 'POST',
    url: `/api/v1/integrations/sap/connections/${connectionId}/financial-guard-v1d3`,
    payload: { dryRun: false },
  });
  assert(firstApply.statusCode === 200, `V1-D3 first apply failed: ${firstApply.statusCode} ${firstApply.body}`);
  const firstPayload = firstApply.json();
  assert(firstPayload.counters.prePoInserted === 1, 'Expected one pre-PO project commitment insert');
  assert(firstPayload.actualCostCanonicalWriteEnabled === false, 'DATA PEP actual writes must remain disabled');

  const afterFirst = await projectFinancialCounts(projectId);
  assert(afterFirst.commitments === before.commitments + 1, 'Expected exactly one project commitment');
  assert(afterFirst.actuals === before.actuals, 'V1-D3 must not create project actual costs');

  const secondApply = await app.inject({
    method: 'POST',
    url: `/api/v1/integrations/sap/connections/${connectionId}/financial-guard-v1d3`,
    payload: { dryRun: false },
  });
  assert(secondApply.statusCode === 200, `V1-D3 repeated apply failed: ${secondApply.statusCode} ${secondApply.body}`);
  assert((await projectFinancialCounts(projectId)).commitments === afterFirst.commitments, 'Repeated V1-D3 apply duplicated commitment');

  await importWorkbook(app, connectionId, 'sap-project-procurement-with-po-v1d3.xlsx', await workbook([
    'Solicitud de pedido', 'Pos.solicitud pedido', 'Pedido', 'Posición de pedido', 'Entrada mercancías',
    'Material', 'Cantidad solicitada', 'Valor total', 'Unidad de medida', 'Centro',
  ], [[prNumber, 10, poNumber, 20, 'Sí', material, 10, 100, 'UND', '1000']]), '2026-08-29T12:00:00.000Z');

  await importWorkbook(app, connectionId, 'sap-open-po-v1d3.xlsx', await workbook([
    'Documento compras', 'Por entregar (cantidad)', 'Solicitud de pedido', 'Pos.solicitud pedido', 'Posición',
    'Cantidad de pedido', 'Fecha de entrega', 'Proveedor/Centro suministrador', 'Material',
    'Precio neto', 'Moneda', 'Centro', 'Unidad medida pedido',
  ], [[poNumber, 10, prNumber, 10, 20, 10, '30.08.2026', `${supplier} PROVEEDOR V1D3`, material, 10, 'USD', '1000', 'UND']]), '2026-08-29T12:01:00.000Z');

  await importWorkbook(app, connectionId, 'sap-commitments-po-v1d3.xlsx', await workbook([
    'Elemento PEP', 'Nº docum.refer.', 'Pos.referencia', 'Tipo de documento de referencia',
    'Tipo de valor', 'Operación', 'Val/Mon.so.CO', 'Moneda del informe', 'Material',
    'Texto breve de material', 'Fecha de cargo',
  ], [[wbs, poNumber, 20, 'Pedido', 21, 'RKP1', 100, 'USD', material, 'Material V1-D3', '29.08.2026']]), '2026-08-29T12:02:00.000Z');

  const procurementSync = await app.inject({
    method: 'POST',
    url: `/api/v1/integrations/sap/connections/${connectionId}/canonical-sync-v1d1`,
    payload: { workspaceId, dryRun: false },
  });
  assert(procurementSync.statusCode === 200, `V1-D1 prerequisite failed: ${procurementSync.statusCode} ${procurementSync.body}`);

  const transitionApply = await app.inject({
    method: 'POST',
    url: `/api/v1/integrations/sap/connections/${connectionId}/financial-guard-v1d3`,
    payload: { dryRun: false },
  });
  assert(transitionApply.statusCode === 200, `V1-D3 transition apply failed: ${transitionApply.statusCode} ${transitionApply.body}`);
  const transition = transitionApply.json();
  assert(transition.counters.prePoClosed === 1, 'Expected pre-PO commitment to close after PO became authoritative');
  assert(transition.counters.purchaseOrdersScoped === 1, 'Expected purchase order to be scoped to mapped project');

  const canonical = await withTenant(tenantId, async (tx) => {
    const commitment = await tx.$queryRaw<Array<{
      amount: Prisma.Decimal | number | string;
      released_amount: Prisma.Decimal | number | string;
      status: string;
    }>>(Prisma.sql`
      SELECT c.amount, c.released_amount, c.status
      FROM integration_entity_links link
      JOIN project_commitments c ON c.id = link.canonical_entity_id
      WHERE link.tenant_id=${tenantId}::uuid
        AND link.integration_connection_id=${connectionId}::uuid
        AND link.external_entity_type='SAP_PRE_PO_COMMITMENT'
        AND link.external_key=${`PR:${prNumber}:00010`}
    `);
    const po = await tx.$queryRaw<Array<{ project_object_id: string | null }>>(Prisma.sql`
      SELECT po.project_object_id
      FROM integration_entity_links link
      JOIN purchase_order_lines pol ON pol.id = link.canonical_entity_id
      JOIN purchase_orders po ON po.id = pol.purchase_order_id
      WHERE link.tenant_id=${tenantId}::uuid
        AND link.integration_connection_id=${connectionId}::uuid
        AND link.external_entity_type='SAP_PURCHASE_ORDER_LINE'
        AND link.external_key=${`PO:${poNumber}:00020`}
    `);
    return { commitment: commitment[0], po: po[0] };
  });

  assert(canonical.commitment?.status === 'CLOSED', 'Pre-PO commitment did not close');
  assert(Number(canonical.commitment?.released_amount ?? 0) === Number(canonical.commitment?.amount ?? -1), 'Closed commitment was not fully released');
  assert(canonical.po?.project_object_id === projectId, 'Purchase order was not assigned to mapped project');

  const overview = await app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}/cost-overview-v2` });
  assert(overview.statusCode === 200, `Cost overview failed: ${overview.statusCode} ${overview.body}`);
  const cost = overview.json();
  assert(cost.summary.manualOpenCommitment === 0, `Expected closed PR commitment to contribute zero, got ${cost.summary.manualOpenCommitment}`);
  assert(cost.summary.materialOpenCommitment === 100, `Expected exactly 100 PO commitment, got ${cost.summary.materialOpenCommitment}`);

  const afterTransition = await projectFinancialCounts(projectId);
  assert(afterTransition.commitments === afterFirst.commitments, 'PO transition created a duplicate project commitment');
  assert(afterTransition.actuals === before.actuals, 'DATA PEP was written before V1-D4');

  await app.close();
  console.log(JSON.stringify({
    sapFinancialGuardV1d3: 'PASS',
    isolatedProject: true,
    wbsProjectMappingRequired: true,
    prePoCommitmentCreated: true,
    repeatedApplyIdempotent: true,
    prePoCommitmentClosedOnPo: true,
    purchaseOrderBecomesCommitmentAuthority: true,
    poScopedToProject: true,
    dataPepActualsDeferred: true,
    goodsReceiptDataPepDoubleCountBlocked: true,
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
