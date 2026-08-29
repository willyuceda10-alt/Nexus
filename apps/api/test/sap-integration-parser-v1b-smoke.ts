import ExcelJS from 'exceljs';
import { prisma } from '../src/db.js';
import { buildApp } from '../src/app.js';
import { MemoryIntegrationBinaryStoreV1 } from '../src/integration-binary-store-v1.js';
import { withTenant } from '../src/tenant-transaction.js';

const TENANT_ID = process.env.DEV_TENANT_ID ?? '00000000-0000-4000-8000-000000000002';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function makeProjectProcurementWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Datos SAP');
  worksheet.addRow([
    'Solicitud de pedido', 'Creado por', 'Fecha de solicitud', 'Fecha de liberación',
    'Pos.solicitud pedido', 'Status tratamiento', 'Grupo de compras', 'Grupo de artículos',
    'Material', 'Texto breve', 'Cantidad solicitada', 'Unidad de medida', 'Valor total', 'Moneda',
    'Centro', 'Solicitante', 'Tipo de imputación', 'Pedido', 'Posición de pedido',
    'Entrada mercancías', 'Nº reserva', 'Indicador de bloqueo',
  ]);
  worksheet.addRow([
    '1000001763', 'SAPUSER', new Date('2026-08-10T00:00:00Z'), new Date('2026-08-11T00:00:00Z'),
    4420, 'B', 'A03', '1904', '13000372', 'SOLENOID TEST', 9, 'UN', 8704.8, 'PEN',
    'CSMV', 'SOLICITANTE', 'K', '4500035208', 180, 'Sí', 0, '',
  ]);
  worksheet.addRow([
    '1000001763', 'SAPUSER', new Date('2026-08-10T00:00:00Z'), new Date('2026-08-11T00:00:00Z'),
    4430, 'N', 'A03', 'SERV', null, 'SERVICIO TECNICO', 1, 'SRV', 1200, 'PEN',
    'CSMV', 'SOLICITANTE', 'K', null, null, 'Sí', 0, '',
  ]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function makeUnknownWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('No SAP');
  worksheet.addRow(['Foo', 'Bar', 'Baz']);
  worksheet.addRow(['1', '2', '3']);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function main() {
  const connection = await withTenant(TENANT_ID, (tx) => tx.integrationConnection.create({
    data: {
      tenantId: TENANT_ID,
      provider: 'SAP',
      status: 'ACTIVE',
      displayName: `SAP Parser V1-B Smoke ${Date.now()}`,
      config: { purpose: 'parser-v1b-smoke' },
    },
    select: { id: true },
  }));

  const app = await buildApp({ integrationBinaryStore: new MemoryIntegrationBinaryStoreV1() });
  const workbookBytes = await makeProjectProcurementWorkbook();

  try {
    const upload = await app.inject({
      method: 'POST',
      url: `/api/v1/integrations/sap/connections/${connection.id}/imports:auto`,
      headers: {
        'content-type': 'application/octet-stream',
        'x-bridata-file-name': 'DATA_PEP_nombre_enganoso.xlsx',
        'x-bridata-original-content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'x-bridata-source-generated-at': '2026-08-29T19:00:00.000Z',
      },
      payload: workbookBytes,
    });
    assert(upload.statusCode === 201, `Automatic parser upload failed: ${upload.statusCode} ${upload.body}`);
    const result = upload.json<{
      duplicate: boolean;
      detection: { sourceKey: string; profileId: string; sheetName: string; headerRowNumber: number };
      batch: { id: string; status: string; counts: { total: number; accepted: number; rejected: number } };
    }>();
    assert(result.duplicate === false, 'First parsed workbook was incorrectly marked duplicate.');
    assert(result.detection.sourceKey === 'SAP_PROJECT_PROCUREMENT', 'Filename influenced source detection.');
    assert(result.detection.profileId === 'project_procurement_v1', 'Unexpected parser profile detected.');
    assert(result.detection.sheetName === 'Datos SAP' && result.detection.headerRowNumber === 1, 'Header location was not persisted in detection result.');
    assert(result.batch.status === 'SUCCEEDED', `Expected successful parsed batch, got ${result.batch.status}.`);
    assert(result.batch.counts.total === 2 && result.batch.counts.accepted === 2 && result.batch.counts.rejected === 0, 'Parsed batch counts are incorrect.');

    const persisted = await withTenant(TENANT_ID, async (tx) => {
      const [sources, records, issues, entityLinks, audits, events] = await Promise.all([
        tx.$queryRaw<Array<{ source_key: string; parser_version: string }>>`
          SELECT source_key, parser_version FROM integration_sources
          WHERE integration_connection_id = ${connection.id}::uuid
        `,
        tx.$queryRaw<Array<{
          row_number: number;
          external_key: string | null;
          raw_payload: unknown;
          normalized_payload: Record<string, unknown> | null;
          validation_status: string;
          processing_status: string;
        }>>`
          SELECT row_number, external_key, raw_payload, normalized_payload, validation_status, processing_status
          FROM integration_import_records
          WHERE batch_id = ${result.batch.id}::uuid
          ORDER BY row_number
        `,
        tx.$queryRaw<Array<{ code: string; record_id: string | null }>>`
          SELECT code, record_id FROM integration_import_issues
          WHERE batch_id = ${result.batch.id}::uuid
        `,
        tx.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*) AS count FROM integration_entity_links
          WHERE integration_connection_id = ${connection.id}::uuid
        `,
        tx.auditLog.count({ where: { tenantId: TENANT_ID, resourceId: result.batch.id, action: 'SAP_IMPORT_AUTO_PARSED' } }),
        tx.domainEvent.count({ where: { tenantId: TENANT_ID, aggregateId: result.batch.id, eventType: 'bridata.integration.sap.import.parsed' } }),
      ]);
      return { sources, records, issues, entityLinks: Number(entityLinks[0]?.count ?? 0), audits, events };
    });

    assert(persisted.sources.length === 1, 'Automatic parser did not create exactly one logical source.');
    assert(persisted.sources[0]?.source_key === 'SAP_PROJECT_PROCUREMENT', 'Logical source key was not persisted.');
    assert(persisted.records.length === 2, 'Parsed RAW/normalized rows did not persist exactly once.');
    assert(persisted.records[0]?.external_key === 'PR:1000001763:04420', 'PR + position external identity was not normalized.');
    assert(persisted.records[1]?.external_key === 'PR:1000001763:04430', 'Second PR line identity was not normalized.');
    assert(Array.isArray((persisted.records[0]?.raw_payload as { cells?: unknown[] } | null)?.cells), 'RAW payload did not preserve cells as immutable source evidence.');
    assert(persisted.records[1]?.normalized_payload?.itemKind === 'SERVICE', 'Service row was not separated from physical material.');
    assert(persisted.records[1]?.normalized_payload?.goodsReceiptExpected === true, 'Goods-receipt eligibility was not normalized.');
    assert(!Object.prototype.hasOwnProperty.call(persisted.records[1]?.normalized_payload ?? {}, 'received'), 'Goods-receipt eligibility was incorrectly converted into receipt status.');
    assert(persisted.issues.length === 0, `Unexpected row issues in valid project procurement workbook: ${JSON.stringify(persisted.issues)}`);
    assert(persisted.entityLinks === 0, 'V1-B wrote canonical entity links before reconciliation/application phase.');
    assert(persisted.audits === 1 && persisted.events === 1, 'Automatic parsing audit/domain event missing or duplicated.');

    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/v1/integrations/sap/connections/${connection.id}/imports:auto`,
      headers: {
        'content-type': 'application/octet-stream',
        'x-bridata-file-name': 'EXPORT_otro_nombre.xlsx',
      },
      payload: workbookBytes,
    });
    assert(duplicate.statusCode === 200, `Duplicate parsed upload failed: ${duplicate.statusCode} ${duplicate.body}`);
    const duplicateResult = duplicate.json<{ duplicate: boolean; batch: { id: string }; detection: { sourceKey: string } }>();
    assert(duplicateResult.duplicate === true, 'Same workbook bytes were not idempotent.');
    assert(duplicateResult.batch.id === result.batch.id, 'Duplicate parsing created a second batch.');
    assert(duplicateResult.detection.sourceKey === 'SAP_PROJECT_PROCUREMENT', 'Changing filename changed source detection.');

    const unknown = await app.inject({
      method: 'POST',
      url: `/api/v1/integrations/sap/connections/${connection.id}/imports:auto`,
      headers: {
        'content-type': 'application/octet-stream',
        'x-bridata-file-name': 'parece_sap.xlsx',
      },
      payload: await makeUnknownWorkbook(),
    });
    assert(unknown.statusCode === 422, `Unknown structure should be rejected with 422, got ${unknown.statusCode} ${unknown.body}`);

    const capabilities = await app.inject({ method: 'GET', url: '/api/v1/integrations/sap/parser-capabilities-v1b' });
    assert(capabilities.statusCode === 200, `Parser capabilities failed: ${capabilities.statusCode}`);
    const capabilityBody = capabilities.json<{
      filenameUsedForDetection: boolean;
      canonicalWriteEnabled: boolean;
      servicePrincipalAuthenticationEnabled: boolean;
    }>();
    assert(capabilityBody.filenameUsedForDetection === false, 'Capabilities incorrectly claim filename-based detection.');
    assert(capabilityBody.canonicalWriteEnabled === false, 'Parser phase unexpectedly enables canonical writes.');
    assert(capabilityBody.servicePrincipalAuthenticationEnabled === false, 'Service-principal auth was enabled before its security phase.');

    const visibleWithoutTenant = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM integration_import_records WHERE batch_id = ${result.batch.id}::uuid
    `;
    assert(Number(visibleWithoutTenant[0]?.count ?? 0) === 0, 'Parsed import records did not fail closed under RLS.');

    console.info(JSON.stringify({
      sapIntegrationParserV1b: 'PASS',
      structureDetection: true,
      filenameIndependent: true,
      logicalSourceAutoProvisioning: true,
      rawAndNormalizedRows: true,
      serviceVsMaterialSeparation: true,
      goodsReceiptFlagNotReceiptStatus: true,
      sha256IdempotencyPreserved: true,
      unsupportedStructureRejected: true,
      canonicalWritesDisabled: true,
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
