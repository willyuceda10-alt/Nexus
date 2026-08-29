import ExcelJS from 'exceljs';
import { prisma } from '../src/db.js';
import { buildApp } from '../src/app.js';
import { MemoryIntegrationBinaryStoreV1 } from '../src/integration-binary-store-v1.js';
import { withTenant } from '../src/tenant-transaction.js';

const TENANT_ID = process.env.DEV_TENANT_ID ?? '00000000-0000-4000-8000-000000000002';

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

async function upload(
  app: Awaited<ReturnType<typeof buildApp>>,
  connectionId: string,
  content: Buffer,
  generatedAt: string,
  fileName: string,
) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/integrations/sap/connections/${connectionId}/imports:auto`,
    headers: {
      'content-type': 'application/octet-stream',
      'x-bridata-file-name': fileName,
      'x-bridata-source-generated-at': generatedAt,
      'x-bridata-original-content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
    payload: content,
  });
  assert(response.statusCode === 201, `SAP parser prerequisite failed: ${response.statusCode} ${response.body}`);
  return response.json<{ batch: { id: string }; detection: { sourceKey: string } }>();
}

async function canonicalCounts() {
  return withTenant(TENANT_ID, async (tx) => {
    const rows = await tx.$queryRaw<Array<{
      requisitions: bigint;
      orders: bigint;
      movements: bigint;
      commitments: bigint;
      actuals: bigint;
    }>>`
      SELECT
        (SELECT COUNT(*) FROM purchase_requisitions WHERE tenant_id = ${TENANT_ID}::uuid) AS requisitions,
        (SELECT COUNT(*) FROM purchase_orders WHERE tenant_id = ${TENANT_ID}::uuid) AS orders,
        (SELECT COUNT(*) FROM inventory_movements WHERE tenant_id = ${TENANT_ID}::uuid) AS movements,
        (SELECT COUNT(*) FROM project_commitments WHERE tenant_id = ${TENANT_ID}::uuid) AS commitments,
        (SELECT COUNT(*) FROM project_actual_costs WHERE tenant_id = ${TENANT_ID}::uuid) AS actuals
    `;
    const row = rows[0]!;
    return {
      requisitions: Number(row.requisitions),
      orders: Number(row.orders),
      movements: Number(row.movements),
      commitments: Number(row.commitments),
      actuals: Number(row.actuals),
    };
  });
}

async function main() {
  const connection = await withTenant(TENANT_ID, (tx) => tx.integrationConnection.create({
    data: {
      tenantId: TENANT_ID,
      provider: 'SAP',
      status: 'ACTIVE',
      displayName: `SAP Reconciliation V1-C Smoke ${Date.now()}`,
      config: { purpose: 'reconciliation-v1c-smoke' },
    },
    select: { id: true },
  }));
  const app = await buildApp({ integrationBinaryStore: new MemoryIntegrationBinaryStoreV1() });

  try {
    const projectHeaders = [
      'Solicitud de pedido', 'Pos.solicitud pedido', 'Pedido', 'Posición de pedido', 'Entrada mercancías',
      'Material', 'Cantidad solicitada', 'Unidad de medida', 'Valor total', 'Moneda', 'Centro',
    ];
    const oldProject = await workbook(projectHeaders, [[
      '1000001763', 4420, '4500000001', 10, 'Sí', '13003098', 26, 'UN', 2600, 'PEN', 'CSMV',
    ]]);
    const newProject = await workbook(projectHeaders, [[
      '1000001763', 4420, '4500035208', 180, 'Sí', '13003098', 26, 'UN', 2600, 'PEN', 'CSMV',
    ]]);
    const oldBatch = await upload(app, connection.id, oldProject, '2026-08-28T10:00:00.000Z', 'seguimiento_anterior.xlsx');
    const newBatch = await upload(app, connection.id, newProject, '2026-08-29T10:00:00.000Z', 'seguimiento_actual.xlsx');

    const openOrder = await workbook([
      'Documento compras', 'Por entregar (cantidad)', 'Solicitud de pedido', 'Pos.solicitud pedido', 'Posición',
      'Cantidad de pedido', 'Fecha de entrega', 'Proveedor/Centro suministrador', 'Material', 'Precio neto', 'Moneda', 'Centro',
    ], [[
      '4500035208', 100, '1000001763', 4420, 180, 297, '30.08.2026', 'PROV-1', '13003098', 100, 'PEN', 'CSMV',
    ]]);
    await upload(app, connection.id, openOrder, '2026-08-29T11:00:00.000Z', 'pendientes.xlsx');

    const commitments = await workbook([
      'Elemento PEP', 'Nº docum.refer.', 'Pos.referencia', 'Tipo de documento de referencia',
      'Tipo de valor', 'Operación', 'Material', 'Proveedor', 'Ejercicio', 'Cantidad total', 'Val/Mon.so.CO',
    ], [
      ['CSF-25-SAG-TR-I-RASN-012', '1000001763', 4420, 'SolP', 21, 'RMBA', '13003098', 'PROV-1', 2026, 26, 2600],
      ['CSF-25-SAG-TR-I-RASN-012', '4500035208', 180, 'Ped.', 22, 'RMBE', '13003098', 'PROV-1', 2026, 26, 2600],
    ]);
    await upload(app, connection.id, commitments, '2026-08-29T11:30:00.000Z', 'compromisos.xlsx');

    const movements = await workbook([
      'Centro', 'Almacén', 'Cantidad', 'Clase de movimiento', 'Fe.contabilización',
      'Nº reserva', 'Nº pos.reserva traslado', 'Material', 'Pedido', 'Posición', 'Elemento PEP',
    ], [
      ['CSMV', '0001', 26, 101, '29.08.2026', 0, 0, '13003098', '4500035208', 180, 'CSF-25-SAG-TR-I-RASN-012'],
      ['CSMV', '0001', -26, 221, '29.08.2026', '1609505', 1, '13003098', null, null, 'CSF-25-SAG-TR-I-RASN-012'],
    ]);
    await upload(app, connection.id, movements, '2026-08-29T12:00:00.000Z', 'movimientos.xlsx');

    const actualCosts = await workbook([
      'Elemento PEP', 'Tipo de valor', 'Clase de documento', 'Fe.contabilización', 'Número de documento',
      'Operación', 'Operación original', 'Material', 'Cantidad total reg.', 'Nº docum.refer.', 'Val/Mon.so.CO',
    ], [
      ['CSF-25-SAG-TR-I-RASN-012', 4, 'WE', '29.08.2026', '5001728228', 'COIE', 'RMWE', '13003098', 26, '5001728228', 2600],
      ['CSF-25-SAG-TR-I-RASN-012', 4, 'WA', '29.08.2026', '4910568615', 'COIN', 'RMWA', '13003098', 26, '4910568615', 2600],
    ]);
    await upload(app, connection.id, actualCosts, '2026-08-29T12:30:00.000Z', 'costos.xlsx');

    const before = await canonicalCounts();
    const dryRun = await app.inject({
      method: 'POST',
      url: `/api/v1/integrations/sap/connections/${connection.id}/reconcile-v1c`,
      payload: { dryRun: true },
    });
    assert(dryRun.statusCode === 200, `Reconciliation dry-run failed: ${dryRun.statusCode} ${dryRun.body}`);
    const dry = dryRun.json<{
      canonicalWriteEnabled: boolean;
      latestBatches: Array<{ id: string; sourceKey: string }>;
      summary: { exactMatches: number; proposedMatches: number; ambiguousMatches: number; conflicts: number };
      appliedLinks: number;
    }>();
    assert(dry.canonicalWriteEnabled === false, 'V1-C unexpectedly enabled canonical writes.');
    assert(dry.appliedLinks === 0, 'Dry-run persisted reconciliation links.');
    assert(!dry.latestBatches.some((batch) => batch.id === oldBatch.batch.id), 'Old project-procurement snapshot was included in latest-batch reconciliation.');
    assert(dry.latestBatches.some((batch) => batch.id === newBatch.batch.id), 'Latest project-procurement snapshot was not selected.');
    assert(dry.summary.exactMatches >= 4, `Expected exact PR/PO/commitment/receipt matches, got ${JSON.stringify(dry.summary)}.`);
    assert(dry.summary.proposedMatches === 2, `Expected two unique movement-to-actual proposals, got ${JSON.stringify(dry.summary)}.`);
    assert(dry.summary.ambiguousMatches === 0, `Unexpected ambiguous matches: ${JSON.stringify(dry.summary)}.`);
    assert(dry.summary.conflicts === 0, `Unexpected exact-key conflicts: ${JSON.stringify(dry.summary)}.`);

    const applied = await app.inject({
      method: 'POST',
      url: `/api/v1/integrations/sap/connections/${connection.id}/reconcile-v1c`,
      payload: { dryRun: false },
    });
    assert(applied.statusCode === 200, `Reconciliation apply failed: ${applied.statusCode} ${applied.body}`);
    const application = applied.json<{ appliedLinks: number; summary: { exactMatches: number; proposedMatches: number } }>();
    assert(application.appliedLinks === application.summary.exactMatches + application.summary.proposedMatches, 'Persisted reconciliation link count differs from plan.');

    const persisted = await withTenant(TENANT_ID, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ relationship_type: string; match_method: string; confidence: unknown; status: string }>>`
        SELECT relationship_type, match_method, confidence, status
        FROM integration_reconciliation_links
        WHERE integration_connection_id = ${connection.id}::uuid
        ORDER BY relationship_type, status
      `;
      const audits = await tx.auditLog.count({
        where: { tenantId: TENANT_ID, resourceId: connection.id, action: 'SAP_RECONCILIATION_V1C_APPLIED' },
      });
      const events = await tx.domainEvent.count({
        where: { tenantId: TENANT_ID, aggregateId: connection.id, eventType: 'bridata.integration.sap.reconciliation.v1c.applied' },
      });
      return { rows, audits, events };
    });
    assert(persisted.rows.some((row) => row.relationship_type === 'REQUISITION_LINE_TO_PURCHASE_ORDER_LINE' && row.status === 'MATCHED'), 'Exact PR -> PO reconciliation was not persisted.');
    assert(persisted.rows.some((row) => row.relationship_type === 'PURCHASE_ORDER_LINE_TO_MATERIAL_RECEIPT' && row.status === 'MATCHED'), 'Exact PO -> receipt reconciliation was not persisted.');
    assert(persisted.rows.filter((row) => row.relationship_type === 'MATERIAL_MOVEMENT_TO_ACTUAL_COST' && row.status === 'PROPOSED').length === 2, 'Heuristic movement -> actual-cost proposals were not persisted truthfully.');
    assert(persisted.audits === 1 && persisted.events === 1, 'Reconciliation audit/domain event missing or duplicated.');

    const reapplied = await app.inject({
      method: 'POST',
      url: `/api/v1/integrations/sap/connections/${connection.id}/reconcile-v1c`,
      payload: { dryRun: false },
    });
    assert(reapplied.statusCode === 200, `Idempotent reconciliation reapply failed: ${reapplied.statusCode} ${reapplied.body}`);
    const linkCountAfterReapply = await withTenant(TENANT_ID, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count FROM integration_reconciliation_links
        WHERE integration_connection_id = ${connection.id}::uuid
      `;
      return Number(rows[0]?.count ?? 0);
    });
    assert(linkCountAfterReapply === persisted.rows.length, 'Reapplying reconciliation duplicated links.');

    const after = await canonicalCounts();
    assert(JSON.stringify(after) === JSON.stringify(before), `V1-C changed canonical operational tables: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);

    const visibleWithoutTenant = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM integration_reconciliation_links
      WHERE integration_connection_id = ${connection.id}::uuid
    `;
    assert(Number(visibleWithoutTenant[0]?.count ?? 0) === 0, 'Reconciliation links did not fail closed under RLS.');

    console.info(JSON.stringify({
      sapIntegrationReconciliationV1c: 'PASS',
      latestSnapshotOnly: true,
      exactRequisitionToPurchaseOrder: true,
      exactCommitmentReferences: true,
      exactPurchaseOrderToReceipt: true,
      reservationToIssueNotInvented: true,
      movementToActualCostIsProposal: true,
      materialDocumentItemRequiredForExactFinancialMatch: true,
      idempotentReconciliationLinks: true,
      canonicalTablesUnchanged: true,
      rlsFailClosed: true,
    }));
  } finally {
    await app.close();
    await withTenant(TENANT_ID, (tx) => tx.integrationConnection.delete({ where: { id: connection.id } }));
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
