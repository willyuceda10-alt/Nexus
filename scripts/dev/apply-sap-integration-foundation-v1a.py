from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one match, found {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")
    print(f"PATCH_OK {path}")


# -----------------------------------------------------------------------------
# Prisma schema: make the integration staging model first-class and queryable.
# -----------------------------------------------------------------------------
replace_once(
    "prisma/schema.prisma",
    "  integrationConnections    IntegrationConnection[]\n",
    "  integrationConnections        IntegrationConnection[]\n"
    "  integrationSources            IntegrationSource[]\n"
    "  integrationImportBatches      IntegrationImportBatch[]\n"
    "  integrationImportRecords      IntegrationImportRecord[]\n"
    "  integrationImportIssues       IntegrationImportIssue[]\n"
    "  integrationEntityLinks        IntegrationEntityLink[]\n"
    "  integrationReconciliationLinks IntegrationReconciliationLink[]\n"
    "  integrationServicePrincipals  IntegrationServicePrincipal[]\n",
)

replace_once(
    "prisma/schema.prisma",
    "  capturedProjectBaselines ProjectBaseline[] @relation(\"CapturedProjectBaselines\")\n",
    "  capturedProjectBaselines              ProjectBaseline[] @relation(\"CapturedProjectBaselines\")\n"
    "  confirmedIntegrationReconciliations IntegrationReconciliationLink[] @relation(\"IntegrationReconciliationConfirmedBy\")\n",
)

old_connection = '''model IntegrationConnection {
  id                  String            @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId            String            @map("tenant_id") @db.Uuid
  provider            IntegrationProvider
  status              IntegrationStatus @default(PENDING)
  displayName         String?           @map("display_name") @db.VarChar(255)
  externalTenantId    String?           @map("external_tenant_id") @db.VarChar(255)
  scopes              String[]          @default([])
  credentialReference String?           @map("credential_reference") @db.Text
  config               Json?             @db.JsonB
  lastSyncAt           DateTime?         @map("last_sync_at") @db.Timestamptz(6)
  createdAt            DateTime          @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt            DateTime          @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, provider, status])
  @@map("integration_connections")
}
'''

new_connection = '''model IntegrationConnection {
  id                  String            @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId            String            @map("tenant_id") @db.Uuid
  provider            IntegrationProvider
  status              IntegrationStatus @default(PENDING)
  displayName         String?           @map("display_name") @db.VarChar(255)
  externalTenantId    String?           @map("external_tenant_id") @db.VarChar(255)
  scopes              String[]          @default([])
  credentialReference String?           @map("credential_reference") @db.Text
  config               Json?            @db.JsonB
  lastSyncAt           DateTime?         @map("last_sync_at") @db.Timestamptz(6)
  createdAt            DateTime          @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt            DateTime          @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant            Tenant                        @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  sources           IntegrationSource[]
  entityLinks       IntegrationEntityLink[]
  reconciliationLinks IntegrationReconciliationLink[]
  servicePrincipals IntegrationServicePrincipal[]

  @@unique([id, tenantId])
  @@index([tenantId, provider, status])
  @@map("integration_connections")
}

model IntegrationSource {
  id                      String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId                String    @map("tenant_id") @db.Uuid
  integrationConnectionId String    @map("integration_connection_id") @db.Uuid
  sourceKey               String    @map("source_key") @db.VarChar(100)
  displayName             String    @map("display_name") @db.VarChar(255)
  schemaVersion           Int       @default(1) @map("schema_version")
  parserVersion           String    @default("1.0.0") @map("parser_version") @db.VarChar(50)
  isActive                Boolean   @default(true) @map("is_active")
  watermark               Json?     @db.JsonB
  config                  Json?     @db.JsonB
  lastSuccessAt           DateTime? @map("last_success_at") @db.Timestamptz(6)
  lastGeneratedAt         DateTime? @map("last_generated_at") @db.Timestamptz(6)
  createdAt               DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt               DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant     Tenant                @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  connection IntegrationConnection @relation(fields: [integrationConnectionId, tenantId], references: [id, tenantId], onDelete: Cascade)
  batches    IntegrationImportBatch[]

  @@unique([tenantId, integrationConnectionId, sourceKey])
  @@unique([id, tenantId])
  @@index([tenantId, integrationConnectionId, isActive])
  @@map("integration_sources")
}

model IntegrationImportBatch {
  id                   String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId             String    @map("tenant_id") @db.Uuid
  integrationSourceId  String    @map("integration_source_id") @db.Uuid
  originalFilename     String    @map("original_filename") @db.VarChar(255)
  contentType          String    @map("content_type") @db.VarChar(150)
  fileSize             BigInt    @map("file_size")
  checksumSha256       String    @map("checksum_sha256") @db.VarChar(64)
  storageKey           String    @map("storage_key") @db.Text
  sourceGeneratedAt    DateTime? @map("source_generated_at") @db.Timestamptz(6)
  receivedAt           DateTime  @default(now()) @map("received_at") @db.Timestamptz(6)
  processingStartedAt  DateTime? @map("processing_started_at") @db.Timestamptz(6)
  processingFinishedAt DateTime? @map("processing_finished_at") @db.Timestamptz(6)
  status               String    @default("RECEIVED") @db.VarChar(30)
  schemaVersion        Int       @map("schema_version")
  parserVersion        String    @map("parser_version") @db.VarChar(50)
  totalRecords         Int       @default(0) @map("total_records")
  acceptedRecords      Int       @default(0) @map("accepted_records")
  insertedRecords      Int       @default(0) @map("inserted_records")
  updatedRecords       Int       @default(0) @map("updated_records")
  unchangedRecords     Int       @default(0) @map("unchanged_records")
  warningRecords       Int       @default(0) @map("warning_records")
  rejectedRecords      Int       @default(0) @map("rejected_records")
  errorSummary         String?   @map("error_summary") @db.Text
  createdAt            DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt            DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant  Tenant             @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  source  IntegrationSource  @relation(fields: [integrationSourceId, tenantId], references: [id, tenantId], onDelete: Cascade)
  records IntegrationImportRecord[]
  issues  IntegrationImportIssue[]

  @@unique([tenantId, integrationSourceId, checksumSha256])
  @@unique([id, tenantId])
  @@index([tenantId, integrationSourceId, receivedAt])
  @@index([tenantId, status, receivedAt])
  @@map("integration_import_batches")
}

model IntegrationImportRecord {
  id                 String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId           String   @map("tenant_id") @db.Uuid
  batchId            String   @map("batch_id") @db.Uuid
  rowNumber          Int      @map("row_number")
  externalKey        String?  @map("external_key") @db.VarChar(255)
  recordHash         String   @map("record_hash") @db.VarChar(64)
  rawPayload         Json     @map("raw_payload") @db.JsonB
  normalizedPayload  Json?    @map("normalized_payload") @db.JsonB
  validationStatus   String   @default("VALID") @map("validation_status") @db.VarChar(20)
  processingStatus   String   @default("PENDING") @map("processing_status") @db.VarChar(20)
  createdAt          DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt          DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant              Tenant                          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  batch               IntegrationImportBatch          @relation(fields: [batchId, tenantId], references: [id, tenantId], onDelete: Cascade)
  issues              IntegrationImportIssue[]
  entityLinks         IntegrationEntityLink[]
  leftReconciliations IntegrationReconciliationLink[] @relation("IntegrationReconciliationLeft")
  rightReconciliations IntegrationReconciliationLink[] @relation("IntegrationReconciliationRight")

  @@unique([tenantId, batchId, rowNumber])
  @@unique([id, tenantId])
  @@index([tenantId, externalKey])
  @@index([tenantId, batchId, recordHash])
  @@map("integration_import_records")
}

model IntegrationImportIssue {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId  String   @map("tenant_id") @db.Uuid
  batchId   String   @map("batch_id") @db.Uuid
  recordId  String?  @map("record_id") @db.Uuid
  severity  String   @db.VarChar(20)
  code      String   @db.VarChar(100)
  fieldKey  String?  @map("field_key") @db.VarChar(150)
  message   String   @db.Text
  details   Json?    @db.JsonB
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant                   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  batch  IntegrationImportBatch   @relation(fields: [batchId, tenantId], references: [id, tenantId], onDelete: Cascade)
  record IntegrationImportRecord? @relation(fields: [recordId, tenantId], references: [id, tenantId], onDelete: Cascade)

  @@index([tenantId, batchId, severity])
  @@index([tenantId, recordId])
  @@map("integration_import_issues")
}

model IntegrationEntityLink {
  id                      String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId                String    @map("tenant_id") @db.Uuid
  integrationConnectionId String    @map("integration_connection_id") @db.Uuid
  sourceRecordId          String?   @map("source_record_id") @db.Uuid
  externalEntityType      String    @map("external_entity_type") @db.VarChar(100)
  externalKey             String    @map("external_key") @db.VarChar(255)
  canonicalEntityType     String    @map("canonical_entity_type") @db.VarChar(100)
  canonicalEntityId       String    @map("canonical_entity_id") @db.Uuid
  metadata                Json?     @db.JsonB
  firstSeenAt             DateTime  @default(now()) @map("first_seen_at") @db.Timestamptz(6)
  lastSeenAt              DateTime  @default(now()) @map("last_seen_at") @db.Timestamptz(6)
  createdAt               DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt               DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant       Tenant                   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  connection   IntegrationConnection    @relation(fields: [integrationConnectionId, tenantId], references: [id, tenantId], onDelete: Cascade)
  sourceRecord IntegrationImportRecord? @relation(fields: [sourceRecordId, tenantId], references: [id, tenantId], onDelete: Restrict)

  @@unique([tenantId, integrationConnectionId, externalEntityType, externalKey])
  @@index([tenantId, canonicalEntityType, canonicalEntityId])
  @@map("integration_entity_links")
}

model IntegrationReconciliationLink {
  id                      String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId                String    @map("tenant_id") @db.Uuid
  integrationConnectionId String    @map("integration_connection_id") @db.Uuid
  leftRecordId            String    @map("left_record_id") @db.Uuid
  rightRecordId           String    @map("right_record_id") @db.Uuid
  relationshipType        String    @map("relationship_type") @db.VarChar(100)
  matchMethod             String    @map("match_method") @db.VarChar(100)
  confidence              Decimal   @default(1) @db.Decimal(5, 4)
  status                  String    @default("MATCHED") @db.VarChar(30)
  evidence                Json?     @db.JsonB
  confirmedByUserId       String?   @map("confirmed_by_user_id") @db.Uuid
  confirmedAt             DateTime? @map("confirmed_at") @db.Timestamptz(6)
  createdAt               DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt               DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant       Tenant                @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  connection   IntegrationConnection @relation(fields: [integrationConnectionId, tenantId], references: [id, tenantId], onDelete: Cascade)
  leftRecord   IntegrationImportRecord @relation("IntegrationReconciliationLeft", fields: [leftRecordId, tenantId], references: [id, tenantId], onDelete: Cascade)
  rightRecord  IntegrationImportRecord @relation("IntegrationReconciliationRight", fields: [rightRecordId, tenantId], references: [id, tenantId], onDelete: Cascade)
  confirmedBy  User?                  @relation("IntegrationReconciliationConfirmedBy", fields: [confirmedByUserId], references: [id], onDelete: SetNull)

  @@unique([tenantId, integrationConnectionId, leftRecordId, rightRecordId, relationshipType])
  @@index([tenantId, leftRecordId, relationshipType])
  @@index([tenantId, rightRecordId, relationshipType])
  @@map("integration_reconciliation_links")
}

model IntegrationServicePrincipal {
  id                      String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId                String    @map("tenant_id") @db.Uuid
  integrationConnectionId String    @map("integration_connection_id") @db.Uuid
  clientId                String    @map("client_id") @db.Uuid
  displayName             String    @map("display_name") @db.VarChar(255)
  allowedSourceKeys       String[]  @default([]) @map("allowed_source_keys")
  status                  String    @default("ACTIVE") @db.VarChar(20)
  lastUsedAt              DateTime? @map("last_used_at") @db.Timestamptz(6)
  createdAt               DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt               DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant     Tenant                @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  connection IntegrationConnection @relation(fields: [integrationConnectionId, tenantId], references: [id, tenantId], onDelete: Cascade)

  @@unique([tenantId, clientId])
  @@index([tenantId, integrationConnectionId, status])
  @@map("integration_service_principals")
}
'''
replace_once("prisma/schema.prisma", old_connection, new_connection)

# Correct composite optional link delete behavior before the migration is applied.
replace_once(
    "prisma/migrations/20260829210000_sap_integration_foundation_v1a/migration.sql",
    'FOREIGN KEY ("source_record_id","tenant_id") REFERENCES "integration_import_records"("id","tenant_id") ON DELETE SET NULL ON UPDATE CASCADE;',
    'FOREIGN KEY ("source_record_id","tenant_id") REFERENCES "integration_import_records"("id","tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;',
)

# -----------------------------------------------------------------------------
# API configuration and binary parser limits.
# -----------------------------------------------------------------------------
replace_once(
    "apps/api/src/config.ts",
    "    DOCUMENT_MAX_FILE_BYTES: z.coerce.number().int().min(1_048_576).max(104_857_600).default(26_214_400),\n",
    "    DOCUMENT_MAX_FILE_BYTES: z.coerce.number().int().min(1_048_576).max(104_857_600).default(26_214_400),\n"
    "    INTEGRATION_STORAGE_MODE: z.enum(['memory', 'azure']).default('memory'),\n"
    "    AZURE_INTEGRATION_CONTAINER: z.string().trim().min(3).max(63).default('bridata-imports'),\n"
    "    INTEGRATION_MAX_FILE_BYTES: z.coerce.number().int().min(1_048_576).max(209_715_200).default(52_428_800),\n",
)

replace_once(
    "apps/api/src/config.ts",
    "    if (env.DOCUMENT_STORAGE_MODE === 'azure') {\n",
    "    if (env.INTEGRATION_STORAGE_MODE === 'azure') {\n"
    "      if (!env.AZURE_STORAGE_ACCOUNT_NAME) {\n"
    "        ctx.addIssue({\n"
    "          code: z.ZodIssueCode.custom,\n"
    "          path: ['AZURE_STORAGE_ACCOUNT_NAME'],\n"
    "          message: 'AZURE_STORAGE_ACCOUNT_NAME is required when INTEGRATION_STORAGE_MODE=azure.',\n"
    "        });\n"
    "      }\n"
    "      if (!env.AZURE_CLIENT_ID) {\n"
    "        ctx.addIssue({\n"
    "          code: z.ZodIssueCode.custom,\n"
    "          path: ['AZURE_CLIENT_ID'],\n"
    "          message: 'AZURE_CLIENT_ID is required for the user-assigned managed identity integration store.',\n"
    "        });\n"
    "      }\n"
    "    }\n\n"
    "    if (env.DOCUMENT_STORAGE_MODE === 'azure') {\n",
)

# -----------------------------------------------------------------------------
# Fastify registration.
# -----------------------------------------------------------------------------
replace_once(
    "apps/api/src/app.ts",
    "import { ProjectScheduleV2ValidationError } from './domain/project-schedule-v2.js';\n",
    "import { ProjectScheduleV2ValidationError } from './domain/project-schedule-v2.js';\n"
    "import {\n"
    "  createConfiguredIntegrationBinaryStoreV1,\n"
    "  type IntegrationBinaryStoreV1,\n"
    "} from './integration-binary-store-v1.js';\n",
)
replace_once(
    "apps/api/src/app.ts",
    "import { scheduleAnalysisV2Routes } from './routes/schedule-analysis-v2.js';\n",
    "import { scheduleAnalysisV2Routes } from './routes/schedule-analysis-v2.js';\n"
    "import { sapIntegrationFoundationV1aRoutes } from './routes/sap-integration-foundation-v1a.js';\n",
)
replace_once(
    "apps/api/src/app.ts",
    "export type BuildAppOptions = {\n  documentBinaryStore?: DocumentBinaryStoreV1;\n};\n",
    "export type BuildAppOptions = {\n"
    "  documentBinaryStore?: DocumentBinaryStoreV1;\n"
    "  integrationBinaryStore?: IntegrationBinaryStoreV1;\n"
    "};\n",
)
replace_once(
    "apps/api/src/app.ts",
    "  const documentBinaryStore = options.documentBinaryStore ?? createConfiguredDocumentBinaryStoreV1();\n",
    "  const documentBinaryStore = options.documentBinaryStore ?? createConfiguredDocumentBinaryStoreV1();\n"
    "  const integrationBinaryStore = options.integrationBinaryStore ?? createConfiguredIntegrationBinaryStoreV1();\n",
)
replace_once(
    "apps/api/src/app.ts",
    "    { parseAs: 'buffer', bodyLimit: config.DOCUMENT_MAX_FILE_BYTES },\n",
    "    { parseAs: 'buffer', bodyLimit: Math.max(config.DOCUMENT_MAX_FILE_BYTES, config.INTEGRATION_MAX_FILE_BYTES) },\n",
)
replace_once(
    "apps/api/src/app.ts",
    "  await documentBinaryV1Routes(app, documentBinaryStore);\n",
    "  await documentBinaryV1Routes(app, documentBinaryStore);\n"
    "  await sapIntegrationFoundationV1aRoutes(app, integrationBinaryStore);\n",
)

# -----------------------------------------------------------------------------
# Local/runtime configuration documentation.
# -----------------------------------------------------------------------------
replace_once(
    ".env.example",
    "# Microsoft 365 integration will use a separate App Registration and Azure Key\n",
    "# Governed source-system imports. Filenames are retained as evidence only; the\n"
    "# logical source key identifies business meaning. Production stores originals\n"
    "# in a private Blob container through the API managed identity.\n"
    "INTEGRATION_STORAGE_MODE=\"memory\"\n"
    "AZURE_INTEGRATION_CONTAINER=\"bridata-imports\"\n"
    "INTEGRATION_MAX_FILE_BYTES=\"52428800\"\n"
    "# INTEGRATION_STORAGE_MODE=\"azure\"\n\n"
    "# Microsoft 365 integration will use a separate App Registration and Azure Key\n",
)

# -----------------------------------------------------------------------------
# Azure: private imports container; existing account-level Blob Data Contributor
# role already authorizes the API managed identity without Shared Key.
# -----------------------------------------------------------------------------
replace_once(
    "infra/azure/main.bicep",
    "resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {\n",
    "resource importsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {\n"
    "  parent: blobService\n"
    "  name: 'bridata-imports'\n"
    "  properties: {\n"
    "    publicAccess: 'None'\n"
    "  }\n"
    "}\n\n"
    "resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {\n",
)
replace_once(
    "infra/azure/main.bicep",
    "    corsOrigins: apiCorsOrigins\n",
    "    corsOrigins: apiCorsOrigins\n"
    "    integrationContainerName: importsContainer.name\n",
)
replace_once(
    "infra/azure/main.bicep",
    "    documentsContainer\n    apiDocumentsBlobContributorRole\n",
    "    documentsContainer\n"
    "    importsContainer\n"
    "    apiDocumentsBlobContributorRole\n",
)
replace_once(
    "infra/azure/main.bicep",
    "output documentsContainerName string = documentsContainer.name\n",
    "output documentsContainerName string = documentsContainer.name\n"
    "output integrationImportsContainerName string = importsContainer.name\n",
)

replace_once(
    "infra/azure/api-runtime.bicep",
    "param documentContainerName string = 'bridata-documents'\n",
    "param documentContainerName string = 'bridata-documents'\n"
    "param integrationContainerName string = 'bridata-imports'\n",
)
replace_once(
    "infra/azure/api-runtime.bicep",
    "            { name: 'DOCUMENT_MAX_FILE_BYTES', value: '26214400' }\n",
    "            { name: 'DOCUMENT_MAX_FILE_BYTES', value: '26214400' }\n"
    "            { name: 'INTEGRATION_STORAGE_MODE', value: 'azure' }\n"
    "            { name: 'AZURE_INTEGRATION_CONTAINER', value: integrationContainerName }\n"
    "            { name: 'INTEGRATION_MAX_FILE_BYTES', value: '52428800' }\n",
)

# -----------------------------------------------------------------------------
# CI smoke is staged for when GitHub Actions quota is available again.
# -----------------------------------------------------------------------------
replace_once(
    ".github/workflows/ci.yml",
    "      - name: Verify persistent object approval lifecycle\n",
    "      - name: Verify SAP integration import foundation\n"
    "        env:\n"
    "          AUTH_MODE: dev\n"
    "          DEV_AUTH_ENABLED: \"true\"\n"
    "          DEV_USER_ID: 00000000-0000-4000-8000-000000000001\n"
    "          DEV_TENANT_ID: 00000000-0000-4000-8000-000000000002\n"
    "          INTEGRATION_STORAGE_MODE: memory\n"
    "        run: npx tsx apps/api/test/sap-integration-foundation-v1a-smoke.ts\n\n"
    "      - name: Verify persistent object approval lifecycle\n",
)

# Temporary patch script must never survive the final commit.
Path(__file__).unlink()
print("SAP_INTEGRATION_FOUNDATION_V1A_PATCH_OK")
