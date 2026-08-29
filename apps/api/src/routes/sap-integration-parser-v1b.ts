import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { isTenantAdministrator } from '../authorization.js';
import { config } from '../config.js';
import type { IntegrationBinaryStoreV1 } from '../integration-binary-store-v1.js';
import { parseSapWorkbookV1, SapWorkbookParseError, type SapParsedIssue, type SapParsedRecord } from '../sap-workbook-parser-v1.js';
import { withTenant } from '../tenant-transaction.js';

const connectionParams = z.object({ connectionId: z.string().uuid() });
const INSERT_CHUNK_SIZE = 250;

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function safeEvidenceFileName(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 255 || /[\x00-\x1F\x7F]/.test(trimmed)) return null;
  if (trimmed.includes('/') || trimmed.includes('\\')) return null;
  return trimmed;
}

function sourceGeneratedAt(value: string | undefined): Date | null | 'invalid' {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'invalid' : parsed;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

type SourceRow = {
  id: string;
  source_key: string;
  display_name: string;
};

type BatchRow = {
  id: string;
  integration_source_id: string;
  original_filename: string;
  content_type: string;
  file_size: bigint;
  checksum_sha256: string;
  status: string;
  total_records: number;
  accepted_records: number;
  warning_records: number;
  rejected_records: number;
  received_at: Date;
};

function batchSummary(row: BatchRow) {
  return {
    id: row.id,
    sourceId: row.integration_source_id,
    originalFilename: row.original_filename,
    contentType: row.content_type,
    fileSize: Number(row.file_size),
    checksumSha256: row.checksum_sha256,
    status: row.status,
    counts: {
      total: row.total_records,
      accepted: row.accepted_records,
      warnings: row.warning_records,
      rejected: row.rejected_records,
    },
    receivedAt: row.received_at.toISOString(),
  };
}

function asJson(value: unknown): string {
  return JSON.stringify(value);
}

async function insertRecords(
  tx: Prisma.TransactionClient,
  tenantId: string,
  batchId: string,
  records: SapParsedRecord[],
): Promise<Map<number, string>> {
  const ids = new Map<number, string>();
  for (const group of chunks(records, INSERT_CHUNK_SIZE)) {
    const rows = group.map((record) => Prisma.sql`(
      ${tenantId}::uuid,
      ${batchId}::uuid,
      ${record.sourceRowNumber},
      ${record.externalKey},
      ${record.recordHash},
      ${asJson(record.rawPayload)}::jsonb,
      ${asJson(record.normalizedPayload)}::jsonb,
      ${record.validationStatus},
      ${record.processingStatus},
      CURRENT_TIMESTAMP
    )`);
    const inserted = await tx.$queryRaw<Array<{ id: string; row_number: number }>>(Prisma.sql`
      INSERT INTO integration_import_records
        (tenant_id, batch_id, row_number, external_key, record_hash, raw_payload,
         normalized_payload, validation_status, processing_status, updated_at)
      VALUES ${Prisma.join(rows)}
      RETURNING id, row_number
    `);
    for (const row of inserted) ids.set(row.row_number, row.id);
  }
  return ids;
}

async function insertIssues(
  tx: Prisma.TransactionClient,
  tenantId: string,
  batchId: string,
  recordIds: Map<number, string>,
  issues: SapParsedIssue[],
): Promise<void> {
  for (const group of chunks(issues, INSERT_CHUNK_SIZE)) {
    const rows = group.map((issue) => Prisma.sql`(
      ${tenantId}::uuid,
      ${batchId}::uuid,
      ${issue.sourceRowNumber === null ? null : recordIds.get(issue.sourceRowNumber) ?? null}::uuid,
      ${issue.severity},
      ${issue.code},
      ${issue.fieldKey},
      ${issue.message},
      ${issue.details === null ? null : asJson(issue.details)}::jsonb
    )`);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO integration_import_issues
        (tenant_id, batch_id, record_id, severity, code, field_key, message, details)
      VALUES ${Prisma.join(rows)}
    `);
  }
}

export async function sapIntegrationParserV1bRoutes(
  app: FastifyInstance,
  binaryStore: IntegrationBinaryStoreV1,
): Promise<void> {
  app.post(
    '/api/v1/integrations/sap/connections/:connectionId/imports:auto',
    { preHandler: [authenticate, resolveActor], bodyLimit: config.INTEGRATION_PARSE_MAX_FILE_BYTES },
    async (request, reply) => {
      const params = connectionParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      if (!isTenantAdministrator(actor)) return reply.code(403).send({ error: 'tenant_admin_required' });
      if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
        return reply.code(400).send({ error: 'integration_import_binary_required' });
      }
      const binaryContent = request.body;
      if (binaryContent.length > config.INTEGRATION_PARSE_MAX_FILE_BYTES) {
        return reply.code(413).send({
          error: 'integration_parse_file_too_large',
          maxBytes: config.INTEGRATION_PARSE_MAX_FILE_BYTES,
        });
      }

      const fileName = safeEvidenceFileName(headerValue(request.headers['x-bridata-file-name']));
      if (!fileName) return reply.code(400).send({ error: 'integration_import_filename_invalid' });
      const generatedAt = sourceGeneratedAt(headerValue(request.headers['x-bridata-source-generated-at']));
      if (generatedAt === 'invalid') return reply.code(400).send({ error: 'integration_source_generated_at_invalid' });
      const originalContentType = headerValue(request.headers['x-bridata-original-content-type'])?.trim();
      const contentType = originalContentType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      if (contentType.length > 150) return reply.code(400).send({ error: 'integration_content_type_invalid' });

      let parsed: Awaited<ReturnType<typeof parseSapWorkbookV1>>;
      try {
        parsed = await parseSapWorkbookV1(binaryContent);
      } catch (error) {
        if (error instanceof SapWorkbookParseError) {
          return reply.code(422).send({
            error: error.code.toLowerCase(),
            message: error.message,
            correlationId: request.id,
          });
        }
        throw error;
      }

      const checksumSha256 = createHash('sha256').update(binaryContent).digest('hex');
      const sourceResult = await withTenant(actor.tenantId, async (tx) => {
        const connection = await tx.integrationConnection.findFirst({
          where: { id: params.data.connectionId, tenantId: actor.tenantId, provider: 'SAP' },
          select: { id: true, status: true },
        });
        if (!connection) return { kind: 'not_found' as const };
        if (connection.status === 'DISCONNECTED') return { kind: 'disconnected' as const };

        const sources = await tx.$queryRaw<SourceRow[]>(Prisma.sql`
          INSERT INTO integration_sources
            (tenant_id, integration_connection_id, source_key, display_name,
             schema_version, parser_version, config, updated_at)
          VALUES
            (${actor.tenantId}::uuid, ${connection.id}::uuid, ${parsed.detection.sourceKey},
             ${parsed.detection.displayName}, 1, 'sap-auto-v1b',
             ${asJson({ autoDetection: true, detectionBasis: 'worksheet_headers' })}::jsonb,
             CURRENT_TIMESTAMP)
          ON CONFLICT (tenant_id, integration_connection_id, source_key)
          DO UPDATE SET
            display_name = EXCLUDED.display_name,
            parser_version = 'sap-auto-v1b',
            is_active = true,
            config = COALESCE(integration_sources.config, '{}'::jsonb) || EXCLUDED.config,
            updated_at = CURRENT_TIMESTAMP
          RETURNING id, source_key, display_name
        `);
        const source = sources[0]!;
        const existing = await tx.$queryRaw<BatchRow[]>(Prisma.sql`
          SELECT id, integration_source_id, original_filename, content_type, file_size,
                 checksum_sha256, status, total_records, accepted_records, warning_records,
                 rejected_records, received_at
          FROM integration_import_batches
          WHERE tenant_id = ${actor.tenantId}::uuid
            AND integration_source_id = ${source.id}::uuid
            AND checksum_sha256 = ${checksumSha256}
        `);
        return { kind: 'ok' as const, connection, source, existing: existing[0] ?? null };
      });

      if (sourceResult.kind === 'not_found') return reply.code(404).send({ error: 'sap_integration_connection_not_found' });
      if (sourceResult.kind === 'disconnected') return reply.code(409).send({ error: 'sap_integration_connection_disconnected' });
      if (sourceResult.existing) {
        return reply.send({
          duplicate: true,
          detection: {
            sourceKey: parsed.detection.sourceKey,
            profileId: parsed.detection.profileId,
            confidence: parsed.detection.confidence,
            sheetName: parsed.sheetName,
            headerRowNumber: parsed.headerRowNumber,
          },
          batch: batchSummary(sourceResult.existing),
        });
      }

      const storageKey = `${actor.tenantId}/${sourceResult.connection.id}/${sourceResult.source.id}/${checksumSha256}`;
      await binaryStore.put({
        storageKey,
        fileName,
        content: binaryContent,
        contentType,
        checksumSha256,
        sourceKey: parsed.detection.sourceKey,
      });

      try {
        const result = await withTenant(actor.tenantId, async (tx) => {
          const inserted = await tx.$queryRaw<BatchRow[]>(Prisma.sql`
            INSERT INTO integration_import_batches
              (tenant_id, integration_source_id, original_filename, content_type, file_size,
               checksum_sha256, storage_key, source_generated_at, processing_started_at, status,
               schema_version, parser_version, updated_at)
            VALUES
              (${actor.tenantId}::uuid, ${sourceResult.source.id}::uuid, ${fileName}, ${contentType},
               ${BigInt(binaryContent.length)}, ${checksumSha256}, ${storageKey}, ${generatedAt},
               CURRENT_TIMESTAMP, 'PROCESSING', 1, ${parsed.detection.profileId}, CURRENT_TIMESTAMP)
            ON CONFLICT (tenant_id, integration_source_id, checksum_sha256) DO NOTHING
            RETURNING id, integration_source_id, original_filename, content_type, file_size,
                      checksum_sha256, status, total_records, accepted_records, warning_records,
                      rejected_records, received_at
          `);
          const batch = inserted[0];
          if (!batch) {
            const existing = await tx.$queryRaw<BatchRow[]>(Prisma.sql`
              SELECT id, integration_source_id, original_filename, content_type, file_size,
                     checksum_sha256, status, total_records, accepted_records, warning_records,
                     rejected_records, received_at
              FROM integration_import_batches
              WHERE tenant_id = ${actor.tenantId}::uuid
                AND integration_source_id = ${sourceResult.source.id}::uuid
                AND checksum_sha256 = ${checksumSha256}
            `);
            return { duplicate: true as const, batch: existing[0]! };
          }

          const recordIds = await insertRecords(tx, actor.tenantId, batch.id, parsed.records);
          await insertIssues(tx, actor.tenantId, batch.id, recordIds, parsed.issues);

          const rejected = parsed.records.filter((record) => record.validationStatus === 'INVALID').length;
          const warningRecords = parsed.records.filter((record) => record.validationStatus === 'WARNING').length;
          const accepted = parsed.records.length - rejected;
          const status = rejected === 0 ? 'SUCCEEDED' : accepted > 0 ? 'PARTIAL' : 'FAILED';

          const completed = await tx.$queryRaw<BatchRow[]>(Prisma.sql`
            UPDATE integration_import_batches
            SET processing_finished_at = CURRENT_TIMESTAMP,
                status = ${status},
                total_records = ${parsed.records.length},
                accepted_records = ${accepted},
                warning_records = ${warningRecords},
                rejected_records = ${rejected},
                updated_at = CURRENT_TIMESTAMP
            WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${batch.id}::uuid
            RETURNING id, integration_source_id, original_filename, content_type, file_size,
                      checksum_sha256, status, total_records, accepted_records, warning_records,
                      rejected_records, received_at
          `);

          if (status !== 'FAILED') {
            await tx.$executeRaw(Prisma.sql`
              UPDATE integration_sources
              SET last_success_at = CURRENT_TIMESTAMP,
                  last_generated_at = COALESCE(${generatedAt}, last_generated_at),
                  updated_at = CURRENT_TIMESTAMP
              WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${sourceResult.source.id}::uuid
            `);
          }
          await Promise.all([
            tx.auditLog.create({
              data: {
                tenantId: actor.tenantId,
                userId: actor.userId,
                action: 'SAP_IMPORT_AUTO_PARSED',
                resource: 'INTEGRATION_IMPORT_BATCH',
                resourceId: batch.id,
                correlationId: request.id,
                ipAddress: request.ip,
                details: {
                  sourceKey: parsed.detection.sourceKey,
                  parserProfile: parsed.detection.profileId,
                  confidence: parsed.detection.confidence,
                  sheetName: parsed.sheetName,
                  headerRowNumber: parsed.headerRowNumber,
                  originalFilename: fileName,
                  checksumSha256,
                  totalRecords: parsed.records.length,
                  acceptedRecords: accepted,
                  rejectedRecords: rejected,
                },
              },
            }),
            tx.domainEvent.create({
              data: {
                tenantId: actor.tenantId,
                aggregateId: batch.id,
                eventType: 'bridata.integration.sap.import.parsed',
                idempotencyKey: `sap-import-parsed:${sourceResult.source.id}:${checksumSha256}`,
                payload: {
                  connectionId: sourceResult.connection.id,
                  sourceId: sourceResult.source.id,
                  sourceKey: parsed.detection.sourceKey,
                  batchId: batch.id,
                  parserProfile: parsed.detection.profileId,
                  status,
                  actorId: actor.userId,
                },
              },
            }),
          ]);

          return { duplicate: false as const, batch: completed[0]! };
        });

        return reply.code(result.duplicate ? 200 : 201).send({
          duplicate: result.duplicate,
          detection: {
            sourceKey: parsed.detection.sourceKey,
            profileId: parsed.detection.profileId,
            confidence: parsed.detection.confidence,
            sheetName: parsed.sheetName,
            headerRowNumber: parsed.headerRowNumber,
            headersDetected: parsed.headers.filter((header) => header.trim()).length,
          },
          batch: batchSummary(result.batch),
          issues: {
            total: parsed.issues.length,
            warnings: parsed.issues.filter((issue) => issue.severity === 'WARNING').length,
            errors: parsed.issues.filter((issue) => issue.severity === 'ERROR').length,
          },
        });
      } catch (error) {
        await binaryStore.delete(storageKey).catch(() => undefined);
        throw error;
      }
    },
  );

  app.get(
    '/api/v1/integrations/sap/parser-capabilities-v1b',
    { preHandler: [authenticate, resolveActor] },
    async () => ({
      version: 'v1b',
      detectionBasis: 'worksheet_headers',
      filenameUsedForDetection: false,
      supportedContainer: 'XLSX',
      maxSheets: 20,
      maxColumns: 256,
      maxRows: 200000,
      stagingPersistence: 'postgresql',
      operationalDataSource: 'bridata_postgresql_canonical',
      excelRole: 'transport_and_audit_evidence_only',
      runtimeReadsImportedWorkbook: false,
      canonicalWriteEnabled: false,
      servicePrincipalAuthenticationEnabled: false,
      supportedSources: [
        'SAP_PROCUREMENT_COMMITMENTS',
        'SAP_PROJECT_PROCUREMENT',
        'SAP_OPEN_PURCHASE_ORDERS',
        'SAP_MATERIAL_MOVEMENTS',
        'SAP_PROJECT_ACTUAL_COSTS',
      ],
    }),
  );
}
