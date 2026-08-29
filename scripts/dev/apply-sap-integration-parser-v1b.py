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

SELF.unlink()
print('SAP_INTEGRATION_PARSER_V1B_PATCH_OK')
