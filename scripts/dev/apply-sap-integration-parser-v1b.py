from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SELF = Path(__file__).resolve()


def patch(path: str, old: str, new: str, count: int = 1) -> None:
    target = ROOT / path
    text = target.read_text(encoding='utf-8')
    found = text.count(old)
    if found < count:
        raise SystemExit(f'PATCH_MISS {path}: expected at least {count} occurrence(s), found {found}')
    text = text.replace(old, new, count)
    target.write_text(text, encoding='utf-8')
    print(f'PATCH_OK {path}')


patch(
    'apps/api/package.json',
    '    "fastify": "^5.4.0",\n    "jose": "^6.0.12",',
    '    "fastify": "^5.4.0",\n    "exceljs": "^4.4.0",\n    "jose": "^6.0.12",',
)

patch(
    'apps/api/src/config.ts',
    "    INTEGRATION_MAX_FILE_BYTES: z.coerce.number().int().min(1_048_576).max(209_715_200).default(52_428_800),\n",
    "    INTEGRATION_MAX_FILE_BYTES: z.coerce.number().int().min(1_048_576).max(209_715_200).default(52_428_800),\n"
    "    INTEGRATION_PARSE_MAX_FILE_BYTES: z.coerce.number().int().min(1_048_576).max(52_428_800).default(26_214_400),\n",
)

patch(
    'apps/api/src/config.ts',
    "    if (env.INTEGRATION_STORAGE_MODE === 'azure') {\n",
    "    if (env.INTEGRATION_PARSE_MAX_FILE_BYTES > env.INTEGRATION_MAX_FILE_BYTES) {\n"
    "      ctx.addIssue({\n"
    "        code: z.ZodIssueCode.custom,\n"
    "        path: ['INTEGRATION_PARSE_MAX_FILE_BYTES'],\n"
    "        message: 'INTEGRATION_PARSE_MAX_FILE_BYTES cannot exceed INTEGRATION_MAX_FILE_BYTES.',\n"
    "      });\n"
    "    }\n\n"
    "    if (env.INTEGRATION_STORAGE_MODE === 'azure') {\n",
)

patch(
    '.env.example',
    'INTEGRATION_MAX_FILE_BYTES="52428800"\n# INTEGRATION_STORAGE_MODE="azure"',
    'INTEGRATION_MAX_FILE_BYTES="52428800"\n'
    'INTEGRATION_PARSE_MAX_FILE_BYTES="26214400"\n'
    '# INTEGRATION_STORAGE_MODE="azure"',
)

patch(
    'apps/api/src/app.ts',
    "import { sapIntegrationFoundationV1aRoutes } from './routes/sap-integration-foundation-v1a.js';\n",
    "import { sapIntegrationFoundationV1aRoutes } from './routes/sap-integration-foundation-v1a.js';\n"
    "import { sapIntegrationParserV1bRoutes } from './routes/sap-integration-parser-v1b.js';\n",
)

patch(
    'apps/api/src/app.ts',
    '  await sapIntegrationFoundationV1aRoutes(app, integrationBinaryStore);\n',
    '  await sapIntegrationFoundationV1aRoutes(app, integrationBinaryStore);\n'
    '  await sapIntegrationParserV1bRoutes(app, integrationBinaryStore);\n',
)

patch(
    'apps/api/src/sap-workbook-parser-v1.ts',
    "import ExcelJS, { type CellValue } from 'exceljs';",
    "import ExcelJS from 'exceljs';",
)
patch(
    'apps/api/src/sap-workbook-parser-v1.ts',
    'function scalarFromCell(value: CellValue): SapCellScalar {',
    'function scalarFromCell(value: ExcelJS.CellValue): SapCellScalar {',
)
patch(
    'apps/api/src/sap-workbook-parser-v1.ts',
    'return scalarFromCell(value.result as CellValue);',
    'return scalarFromCell(value.result as ExcelJS.CellValue);',
)
patch(
    'apps/api/src/sap-workbook-parser-v1.ts',
    'function headerText(value: CellValue): string {',
    'function headerText(value: ExcelJS.CellValue): string {',
)

patch(
    'apps/api/src/routes/sap-integration-parser-v1b.ts',
    '      let parsed;\n      try {\n        parsed = await parseSapWorkbookV1(binaryContent);',
    '      let parsed: Awaited<ReturnType<typeof parseSapWorkbookV1>>;\n      try {\n        parsed = await parseSapWorkbookV1(binaryContent);',
)

patch(
    '.github/workflows/ci.yml',
    '        run: npx tsx apps/api/test/sap-integration-foundation-v1a-smoke.ts\n\n'
    '      - name: Verify persistent object approval lifecycle\n',
    '        run: npx tsx apps/api/test/sap-integration-foundation-v1a-smoke.ts\n\n'
    '      - name: Verify automatic SAP workbook structure detection and parsing\n'
    '        env:\n'
    '          AUTH_MODE: dev\n'
    '          DEV_AUTH_ENABLED: "true"\n'
    '          DEV_USER_ID: 00000000-0000-4000-8000-000000000001\n'
    '          DEV_TENANT_ID: 00000000-0000-4000-8000-000000000002\n'
    '          INTEGRATION_STORAGE_MODE: memory\n'
    '          INTEGRATION_PARSE_MAX_FILE_BYTES: "26214400"\n'
    '        run: npx tsx apps/api/test/sap-integration-parser-v1b-smoke.ts\n\n'
    '      - name: Verify persistent object approval lifecycle\n',
)

patch(
    'infra/azure/main.bicep',
    '  dependsOn: [\n    documentsContainer\n    importsContainer\n    apiDocumentsBlobContributorRole\n',
    '  dependsOn: [\n    documentsContainer\n    apiDocumentsBlobContributorRole\n',
)

patch(
    'apps/api/src/routes/sap-integration-parser-v1b.ts',
    "      maxRows: 200000,\n      canonicalWriteEnabled: false,\n",
    "      maxRows: 200000,\n"
    "      stagingPersistence: 'postgresql',\n"
    "      operationalDataSource: 'bridata_postgresql_canonical',\n"
    "      excelRole: 'transport_and_audit_evidence_only',\n"
    "      runtimeReadsImportedWorkbook: false,\n"
    "      canonicalWriteEnabled: false,\n",
)

patch(
    'apps/api/test/sap-integration-parser-v1b-smoke.ts',
    "async function main() {\n",
    "async function canonicalCounts() {\n"
    "  return withTenant(TENANT_ID, async (tx) => {\n"
    "    const rows = await tx.$queryRaw<Array<{\n"
    "      purchase_requisitions: bigint;\n"
    "      purchase_orders: bigint;\n"
    "      inventory_movements: bigint;\n"
    "      project_commitments: bigint;\n"
    "      project_actual_costs: bigint;\n"
    "    }>>`\n"
    "      SELECT\n"
    "        (SELECT COUNT(*) FROM purchase_requisitions WHERE tenant_id = ${TENANT_ID}::uuid) AS purchase_requisitions,\n"
    "        (SELECT COUNT(*) FROM purchase_orders WHERE tenant_id = ${TENANT_ID}::uuid) AS purchase_orders,\n"
    "        (SELECT COUNT(*) FROM inventory_movements WHERE tenant_id = ${TENANT_ID}::uuid) AS inventory_movements,\n"
    "        (SELECT COUNT(*) FROM project_commitments WHERE tenant_id = ${TENANT_ID}::uuid) AS project_commitments,\n"
    "        (SELECT COUNT(*) FROM project_actual_costs WHERE tenant_id = ${TENANT_ID}::uuid) AS project_actual_costs\n"
    "    `;\n"
    "    const row = rows[0]!;\n"
    "    return {\n"
    "      purchaseRequisitions: Number(row.purchase_requisitions),\n"
    "      purchaseOrders: Number(row.purchase_orders),\n"
    "      inventoryMovements: Number(row.inventory_movements),\n"
    "      projectCommitments: Number(row.project_commitments),\n"
    "      projectActualCosts: Number(row.project_actual_costs),\n"
    "    };\n"
    "  });\n"
    "}\n\n"
    "async function main() {\n",
)

patch(
    'apps/api/test/sap-integration-parser-v1b-smoke.ts',
    "  const app = await buildApp({ integrationBinaryStore: new MemoryIntegrationBinaryStoreV1() });\n  const workbookBytes = await makeProjectProcurementWorkbook();\n\n  try {\n",
    "  const app = await buildApp({ integrationBinaryStore: new MemoryIntegrationBinaryStoreV1() });\n"
    "  const workbookBytes = await makeProjectProcurementWorkbook();\n"
    "  const canonicalBefore = await canonicalCounts();\n\n"
    "  try {\n",
)

patch(
    'apps/api/test/sap-integration-parser-v1b-smoke.ts',
    "    assert(persisted.entityLinks === 0, 'V1-B wrote canonical entity links before reconciliation/application phase.');\n    assert(persisted.audits === 1 && persisted.events === 1, 'Automatic parsing audit/domain event missing or duplicated.');\n\n",
    "    assert(persisted.entityLinks === 0, 'V1-B wrote canonical entity links before reconciliation/application phase.');\n"
    "    assert(persisted.audits === 1 && persisted.events === 1, 'Automatic parsing audit/domain event missing or duplicated.');\n"
    "    const canonicalAfter = await canonicalCounts();\n"
    "    assert(\n"
    "      JSON.stringify(canonicalAfter) === JSON.stringify(canonicalBefore),\n"
    "      `V1-B mutated canonical Bridata tables: before=${JSON.stringify(canonicalBefore)} after=${JSON.stringify(canonicalAfter)}`,\n"
    "    );\n\n",
)

patch(
    'apps/api/test/sap-integration-parser-v1b-smoke.ts',
    "      filenameUsedForDetection: boolean;\n      canonicalWriteEnabled: boolean;\n      servicePrincipalAuthenticationEnabled: boolean;\n",
    "      filenameUsedForDetection: boolean;\n"
    "      stagingPersistence: string;\n"
    "      operationalDataSource: string;\n"
    "      excelRole: string;\n"
    "      runtimeReadsImportedWorkbook: boolean;\n"
    "      canonicalWriteEnabled: boolean;\n"
    "      servicePrincipalAuthenticationEnabled: boolean;\n",
)

patch(
    'apps/api/test/sap-integration-parser-v1b-smoke.ts',
    "    assert(capabilityBody.filenameUsedForDetection === false, 'Capabilities incorrectly claim filename-based detection.');\n    assert(capabilityBody.canonicalWriteEnabled === false, 'Parser phase unexpectedly enables canonical writes.');\n",
    "    assert(capabilityBody.filenameUsedForDetection === false, 'Capabilities incorrectly claim filename-based detection.');\n"
    "    assert(capabilityBody.stagingPersistence === 'postgresql', 'Parsed staging data is not declared PostgreSQL-backed.');\n"
    "    assert(capabilityBody.operationalDataSource === 'bridata_postgresql_canonical', 'Operational data source is not Bridata canonical PostgreSQL.');\n"
    "    assert(capabilityBody.excelRole === 'transport_and_audit_evidence_only', 'Excel is not restricted to transport/audit evidence.');\n"
    "    assert(capabilityBody.runtimeReadsImportedWorkbook === false, 'Runtime incorrectly depends on imported workbook reads.');\n"
    "    assert(capabilityBody.canonicalWriteEnabled === false, 'Parser phase unexpectedly enables canonical writes.');\n",
)

patch(
    'apps/api/test/sap-integration-parser-v1b-smoke.ts',
    "      unsupportedStructureRejected: true,\n      canonicalWritesDisabled: true,\n      rlsFailClosed: true,\n",
    "      unsupportedStructureRejected: true,\n"
    "      stagingPersistedInPostgreSql: true,\n"
    "      excelIsTransportOnly: true,\n"
    "      operationalRuntimeDoesNotReadExcel: true,\n"
    "      canonicalTablesUnchanged: true,\n"
    "      canonicalWritesDisabled: true,\n"
    "      rlsFailClosed: true,\n",
)

SELF.unlink()
print('SAP_INTEGRATION_PARSER_V1B_PATCH_OK')
