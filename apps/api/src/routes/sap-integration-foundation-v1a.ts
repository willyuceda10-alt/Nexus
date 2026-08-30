import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { isTenantAdministrator } from '../authorization.js';
import { config } from '../config.js';
import type { IntegrationBinaryStoreV1 } from '../integration-binary-store-v1.js';
import { withTenant } from '../tenant-transaction.js';

const uuidParams = z.object({ id: z.string().uuid() });
const connectionParams = z.object({ connectionId: z.string().uuid() });
const sourceParams = z.object({ sourceId: z.string().uuid() });
const batchParams = z.object({ batchId: z.string().uuid() });
const sourceKeySchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_]{2,99}$/);
const sourceBody = z.object({
  sourceKey: sourceKeySchema,
  displayName: z.string().trim().min(1).max(255),
  schemaVersion: z.number().int().min(1).max(10_000).default(1),
  parserVersion: z.string().trim().min(1).max(50).default('1.0.0'),
  config: z.record(z.unknown()).nullable().optional(),
});
const servicePrincipalBody = z.object({
  clientId: z.string().uuid(),
  displayName: z.string().trim().min(1).max(255),
  allowedSourceKeys: z.array(sourceKeySchema).min(1).max(100),
});

const allowedExtensions = new Set(['xlsx', 'xls', 'csv']);

function asDate(value: string | string[] | undefined): Date | null | 'invalid' {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? 'invalid' : date;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function safeOriginalFileName(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 255 || /[\x00-\x1F\x7F]/.test(trimmed)) return null;
  if (trimmed.includes('/') || trimmed.includes('\\')) return null;
  const extension = trimmed.includes('.') ? trimmed.split('.').pop()!.toLowerCase() : '';
  if (!allowedExtensions.has(extension)) return null;
  return trimmed;
}

function jsonValue(value: Record<string, unknown> | null | undefined): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value == null ? Prisma.JsonNull : value as Prisma.InputJsonValue;
}

type SourceRow = {
  id: string;
  integration_connection_id: string;
  source_key: string;
  display_name: string;
  schema_version: number;
  parser_version: string;
  is_active: boolean;
  config: Prisma.JsonValue | null;
  watermark: Prisma.JsonValue | null;
  last_success_at: Date | null;
  last_generated_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type BatchRow = {
  id: string;
  integration_source_id: string;
  original_filename: string;
  content_type: string;
  file_size: bigint;
  checksum_sha256: string;
  source_generated_at: Date | null;
  received_at: Date;
  processing_started_at: Date | null;
  processing_finished_at: Date | null;
  status: string;
  schema_version: number;
  parser_version: string;
  total_records: number;
  accepted_records: number;
  inserted_records: number;
  updated_records: number;
  unchanged_records: number;
  warning_records: number;
  rejected_records: number;
  error_summary: string | null;
};

type IssueRow = {
  id: string;
  record_id: string | null;
  severity: string;
  code: string;
  field_key: string | null;
  message: string;
  details: Prisma.JsonValue | null;
  created_at: Date;
};

type ServicePrincipalRow = {
  id: string;
  client_id: string;
  display_name: string;
  allowed_source_keys: string[];
  status: string;
  last_used_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function sourceDto(row: SourceRow) {
  return {
    id: row.id,
    connectionId: row.integration_connection_id,
    sourceKey: row.source_key,
    displayName: row.display_name,
    schemaVersion: row.schema_version,
    parserVersion: row.parser_version,
    isActive: row.is_active,
    config: row.config,
    watermark: row.watermark,
    lastSuccessAt: row.last_success_at?.toISOString() ?? null,
    lastGeneratedAt: row.last_generated_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function batchDto(row: BatchRow) {
  return {
    id: row.id,
    sourceId: row.integration_source_id,
    originalFilename: row.original_filename,
    contentType: row.content_type,
    fileSize: Number(row.file_size),
    checksumSha256: row.checksum_sha256,
    sourceGeneratedAt: row.source_generated_at?.toISOString() ?? null,
    receivedAt: row.received_at.toISOString(),
    processingStartedAt: row.processing_started_at?.toISOString() ?? null,
    processingFinishedAt: row.processing_finished_at?.toISOString() ?? null,
    status: row.status,
    schemaVersion: row.schema_version,
    parserVersion: row.parser_version,
    counts: {
      total: row.total_records,
      accepted: row.accepted_records,
      inserted: row.inserted_records,
      updated: row.updated_records,
      unchanged: row.unchanged_records,
      warnings: row.warning_records,
      rejected: row.rejected_records,
    },
    errorSummary: row.error_summary,
  };
}

async function requireSapConnection(
  tx: Prisma.TransactionClient,
  tenantId: string,
  connectionId: string,
): Promise<{ id: string; status: string } | null> {
  return tx.integrationConnection.findFirst({
    where: { id: connectionId, tenantId, provider: 'SAP' },
    select: { id: true, status: true },
  });
}

async function sourceById(
  tx: Prisma.TransactionClient,
  tenantId: string,
  sourceId: string,
): Promise<SourceRow | null> {
  const rows = await tx.$queryRaw<SourceRow[]>(Prisma.sql`
    SELECT id, integration_connection_id, source_key, display_name, schema_version,
           parser_version, is_active, config, watermark, last_success_at,
           last_generated_at, created_at, updated_at
    FROM integration_sources
    WHERE tenant_id = ${tenantId}::uuid AND id = ${sourceId}::uuid
  `);
  return rows[0] ?? null;
}

export async function sapIntegrationFoundationV1aRoutes(
  app: FastifyInstance,
  binaryStore: IntegrationBinaryStoreV1,
): Promise<void> {
  app.get(
    '/api/v1/integrations/sap/connections/:connectionId/sources',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = connectionParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const connection = await requireSapConnection(tx, actor.tenantId, params.data.connectionId);
        if (!connection) return { kind: 'not_found' as const };
        const rows = await tx.$queryRaw<SourceRow[]>(Prisma.sql`
          SELECT id, integration_connection_id, source_key, display_name, schema_version,
                 parser_version, is_active, config, watermark, last_success_at,
                 last_generated_at, created_at, updated_at
          FROM integration_sources
          WHERE tenant_id = ${actor.tenantId}::uuid
            AND integration_connection_id = ${connection.id}::uuid
          ORDER BY source_key
        `);
        return { kind: 'ok' as const, rows };
      });
      if (result.kind === 'not_found') return reply.code(404).send({ error: 'sap_integration_connection_not_found' });
      return { sources: result.rows.map(sourceDto) };
    },
  );

  app.post(
    '/api/v1/integrations/sap/connections/:connectionId/sources',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = connectionParams.safeParse(request.params);
      const body = sourceBody.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send({ error: 'validation_error', details: body.success ? undefined : body.error.flatten() });
      }
      const actor = request.actor!;
      if (!isTenantAdministrator(actor)) return reply.code(403).send({ error: 'tenant_admin_required' });

      const result = await withTenant(actor.tenantId, async (tx) => {
        const connection = await requireSapConnection(tx, actor.tenantId, params.data.connectionId);
        if (!connection) return { kind: 'not_found' as const };
        if (connection.status === 'DISCONNECTED') return { kind: 'disconnected' as const };

        const rows = await tx.$queryRaw<SourceRow[]>(Prisma.sql`
          INSERT INTO integration_sources
            (tenant_id, integration_connection_id, source_key, display_name,
             schema_version, parser_version, config, updated_at)
          VALUES
            (${actor.tenantId}::uuid, ${connection.id}::uuid, ${body.data.sourceKey},
             ${body.data.displayName}, ${body.data.schemaVersion}, ${body.data.parserVersion},
             ${jsonValue(body.data.config)}, CURRENT_TIMESTAMP)
          ON CONFLICT (tenant_id, integration_connection_id, source_key)
          DO UPDATE SET
            display_name = EXCLUDED.display_name,
            schema_version = EXCLUDED.schema_version,
            parser_version = EXCLUDED.parser_version,
            config = EXCLUDED.config,
            is_active = true,
            updated_at = CURRENT_TIMESTAMP
          RETURNING id, integration_connection_id, source_key, display_name, schema_version,
                    parser_version, is_active, config, watermark, last_success_at,
                    last_generated_at, created_at, updated_at
        `);
        const source = rows[0]!;
        await Promise.all([
          tx.auditLog.create({
            data: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              action: 'INTEGRATION_SOURCE_UPSERTED',
              resource: 'INTEGRATION_SOURCE',
              resourceId: source.id,
              correlationId: request.id,
              ipAddress: request.ip,
              details: { provider: 'SAP', connectionId: connection.id, sourceKey: source.source_key },
            },
          }),
          tx.domainEvent.create({
            data: {
              tenantId: actor.tenantId,
              aggregateId: source.id,
              eventType: 'bridata.integration.source.upserted',
              payload: { provider: 'SAP', connectionId: connection.id, sourceKey: source.source_key, actorId: actor.userId },
            },
          }),
        ]);
        return { kind: 'ok' as const, source };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'sap_integration_connection_not_found' });
      if (result.kind === 'disconnected') return reply.code(409).send({ error: 'sap_integration_connection_disconnected' });
      return reply.code(201).send(sourceDto(result.source));
    },
  );

  app.post(
    '/api/v1/integrations/sap/sources/:sourceId/imports',
    { preHandler: [authenticate, resolveActor], bodyLimit: config.INTEGRATION_MAX_FILE_BYTES },
    async (request, reply) => {
      const params = sourceParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      if (!isTenantAdministrator(actor)) return reply.code(403).send({ error: 'tenant_admin_required' });
      if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
        return reply.code(400).send({ error: 'integration_import_binary_required' });
      }
      const binaryContent = request.body;
      if (binaryContent.length > config.INTEGRATION_MAX_FILE_BYTES) {
        return reply.code(413).send({ error: 'integration_import_too_large', maxBytes: config.INTEGRATION_MAX_FILE_BYTES });
      }

      const fileName = safeOriginalFileName(headerValue(request.headers['x-bridata-file-name']));
      if (!fileName) {
        return reply.code(400).send({ error: 'integration_import_filename_invalid', allowedExtensions: [...allowedExtensions] });
      }
      const sourceGeneratedAt = asDate(request.headers['x-bridata-source-generated-at']);
      if (sourceGeneratedAt === 'invalid') {
        return reply.code(400).send({ error: 'integration_source_generated_at_invalid' });
      }
      const originalContentType = headerValue(request.headers['x-bridata-original-content-type'])?.trim();
      const contentType = originalContentType || 'application/octet-stream';
      if (contentType.length > 150) return reply.code(400).send({ error: 'integration_content_type_invalid' });

      const checksumSha256 = createHash('sha256').update(binaryContent).digest('hex');
      const sourceResult = await withTenant(actor.tenantId, async (tx) => {
        const source = await sourceById(tx, actor.tenantId, params.data.sourceId);
        if (!source || !source.is_active) return { kind: 'not_found' as const };
        const connection = await requireSapConnection(tx, actor.tenantId, source.integration_connection_id);
        if (!connection) return { kind: 'not_found' as const };
        if (connection.status === 'DISCONNECTED') return { kind: 'disconnected' as const };
        const existing = await tx.$queryRaw<BatchRow[]>(Prisma.sql`
          SELECT id, integration_source_id, original_filename, content_type, file_size,
                 checksum_sha256, source_generated_at, received_at, processing_started_at,
                 processing_finished_at, status, schema_version, parser_version,
                 total_records, accepted_records, inserted_records, updated_records,
                 unchanged_records, warning_records, rejected_records, error_summary
          FROM integration_import_batches
          WHERE tenant_id = ${actor.tenantId}::uuid
            AND integration_source_id = ${source.id}::uuid
            AND checksum_sha256 = ${checksumSha256}
        `);
        return { kind: 'ok' as const, source, existing: existing[0] ?? null };
      });
      if (sourceResult.kind === 'not_found') return reply.code(404).send({ error: 'integration_source_not_found' });
      if (sourceResult.kind === 'disconnected') return reply.code(409).send({ error: 'sap_integration_connection_disconnected' });
      if (sourceResult.existing) {
        return reply.send({ duplicate: true, batch: batchDto(sourceResult.existing) });
      }

      const storageKey = `${actor.tenantId}/${sourceResult.source.integration_connection_id}/${sourceResult.source.id}/${checksumSha256}`;
      await binaryStore.put({
        storageKey,
        fileName,
        content: binaryContent,
        contentType,
        checksumSha256,
        sourceKey: sourceResult.source.source_key,
      });

      try {
        const result = await withTenant(actor.tenantId, async (tx) => {
          const inserted = await tx.$queryRaw<BatchRow[]>(Prisma.sql`
            INSERT INTO integration_import_batches
              (tenant_id, integration_source_id, original_filename, content_type, file_size,
               checksum_sha256, storage_key, source_generated_at, status, schema_version,
               parser_version, updated_at)
            VALUES
              (${actor.tenantId}::uuid, ${sourceResult.source.id}::uuid, ${fileName}, ${contentType},
               ${BigInt(binaryContent.length)}, ${checksumSha256}, ${storageKey}, ${sourceGeneratedAt},
               'RECEIVED', ${sourceResult.source.schema_version}, ${sourceResult.source.parser_version},
               CURRENT_TIMESTAMP)
            ON CONFLICT (tenant_id, integration_source_id, checksum_sha256) DO NOTHING
            RETURNING id, integration_source_id, original_filename, content_type, file_size,
                      checksum_sha256, source_generated_at, received_at, processing_started_at,
                      processing_finished_at, status, schema_version, parser_version,
                      total_records, accepted_records, inserted_records, updated_records,
                      unchanged_records, warning_records, rejected_records, error_summary
          `);
          const batch = inserted[0];
          if (!batch) {
            const existing = await tx.$queryRaw<BatchRow[]>(Prisma.sql`
              SELECT id, integration_source_id, original_filename, content_type, file_size,
                     checksum_sha256, source_generated_at, received_at, processing_started_at,
                     processing_finished_at, status, schema_version, parser_version,
                     total_records, accepted_records, inserted_records, updated_records,
                     unchanged_records, warning_records, rejected_records, error_summary
              FROM integration_import_batches
              WHERE tenant_id = ${actor.tenantId}::uuid
                AND integration_source_id = ${sourceResult.source.id}::uuid
                AND checksum_sha256 = ${checksumSha256}
            `);
            return { duplicate: true, batch: existing[0]! };
          }

          await Promise.all([
            tx.auditLog.create({
              data: {
                tenantId: actor.tenantId,
                userId: actor.userId,
                action: 'INTEGRATION_IMPORT_RECEIVED',
                resource: 'INTEGRATION_IMPORT_BATCH',
                resourceId: batch.id,
                correlationId: request.id,
                ipAddress: request.ip,
                details: {
                  provider: 'SAP',
                  sourceKey: sourceResult.source.source_key,
                  checksumSha256,
                  fileSize: binaryContent.length,
                  originalFilename: fileName,
                },
              },
            }),
            tx.domainEvent.create({
              data: {
                tenantId: actor.tenantId,
                aggregateId: batch.id,
                eventType: 'bridata.integration.import.received',
                idempotencyKey: `integration-import:${sourceResult.source.id}:${checksumSha256}`,
                payload: {
                  provider: 'SAP',
                  sourceId: sourceResult.source.id,
                  sourceKey: sourceResult.source.source_key,
                  batchId: batch.id,
                  checksumSha256,
                  actorId: actor.userId,
                },
              },
            }),
          ]);
          return { duplicate: false, batch };
        });
        return reply.code(result.duplicate ? 200 : 201).send({ duplicate: result.duplicate, batch: batchDto(result.batch) });
      } catch (error) {
        await binaryStore.delete(storageKey).catch(() => undefined);
        throw error;
      }
    },
  );

  app.get(
    '/api/v1/integrations/sap/sources/:sourceId/imports',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = sourceParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const source = await sourceById(tx, actor.tenantId, params.data.sourceId);
        if (!source) return { kind: 'not_found' as const };
        const batches = await tx.$queryRaw<BatchRow[]>(Prisma.sql`
          SELECT id, integration_source_id, original_filename, content_type, file_size,
                 checksum_sha256, source_generated_at, received_at, processing_started_at,
                 processing_finished_at, status, schema_version, parser_version,
                 total_records, accepted_records, inserted_records, updated_records,
                 unchanged_records, warning_records, rejected_records, error_summary
          FROM integration_import_batches
          WHERE tenant_id = ${actor.tenantId}::uuid
            AND integration_source_id = ${source.id}::uuid
          ORDER BY received_at DESC
          LIMIT 100
        `);
        return { kind: 'ok' as const, batches };
      });
      if (result.kind === 'not_found') return reply.code(404).send({ error: 'integration_source_not_found' });
      return { batches: result.batches.map(batchDto) };
    },
  );

  app.get(
    '/api/v1/integrations/sap/imports/:batchId',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = batchParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const batches = await tx.$queryRaw<BatchRow[]>(Prisma.sql`
          SELECT id, integration_source_id, original_filename, content_type, file_size,
                 checksum_sha256, source_generated_at, received_at, processing_started_at,
                 processing_finished_at, status, schema_version, parser_version,
                 total_records, accepted_records, inserted_records, updated_records,
                 unchanged_records, warning_records, rejected_records, error_summary
          FROM integration_import_batches
          WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${params.data.batchId}::uuid
        `);
        const batch = batches[0];
        if (!batch) return { kind: 'not_found' as const };
        const issues = await tx.$queryRaw<IssueRow[]>(Prisma.sql`
          SELECT id, record_id, severity, code, field_key, message, details, created_at
          FROM integration_import_issues
          WHERE tenant_id = ${actor.tenantId}::uuid AND batch_id = ${batch.id}::uuid
          ORDER BY created_at, id
          LIMIT 500
        `);
        return { kind: 'ok' as const, batch, issues };
      });
      if (result.kind === 'not_found') return reply.code(404).send({ error: 'integration_import_batch_not_found' });
      return {
        batch: batchDto(result.batch),
        issues: result.issues.map((row) => ({
          id: row.id,
          recordId: row.record_id,
          severity: row.severity,
          code: row.code,
          fieldKey: row.field_key,
          message: row.message,
          details: row.details,
          createdAt: row.created_at.toISOString(),
        })),
      };
    },
  );

  app.post(
    '/api/v1/integrations/sap/imports/:batchId/download-link',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = batchParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      if (!isTenantAdministrator(actor)) return reply.code(403).send({ error: 'tenant_admin_required' });
      const result = await withTenant(actor.tenantId, async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string; storage_key: string }>>(Prisma.sql`
          SELECT id, storage_key FROM integration_import_batches
          WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${params.data.batchId}::uuid
        `);
        return rows[0] ?? null;
      });
      if (!result) return reply.code(404).send({ error: 'integration_import_batch_not_found' });
      const access = await binaryStore.createReadUrl(result.storage_key);
      if (!access) return reply.code(404).send({ error: 'integration_import_binary_not_found' });
      await withTenant(actor.tenantId, (tx) => tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          userId: actor.userId,
          action: 'INTEGRATION_IMPORT_DOWNLOAD_LINK_CREATED',
          resource: 'INTEGRATION_IMPORT_BATCH',
          resourceId: result.id,
          correlationId: request.id,
          ipAddress: request.ip,
          details: { expiresAt: access.expiresAt.toISOString() },
        },
      }));
      return { url: access.url, expiresAt: access.expiresAt.toISOString() };
    },
  );

  app.get(
    '/api/v1/integrations/sap/connections/:connectionId/service-principals',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = connectionParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      if (!isTenantAdministrator(actor)) return reply.code(403).send({ error: 'tenant_admin_required' });
      const result = await withTenant(actor.tenantId, async (tx) => {
        if (!(await requireSapConnection(tx, actor.tenantId, params.data.connectionId))) return { kind: 'not_found' as const };
        const rows = await tx.$queryRaw<ServicePrincipalRow[]>(Prisma.sql`
          SELECT id, client_id::text, display_name, allowed_source_keys, status,
                 last_used_at, created_at, updated_at
          FROM integration_service_principals
          WHERE tenant_id = ${actor.tenantId}::uuid
            AND integration_connection_id = ${params.data.connectionId}::uuid
          ORDER BY display_name
        `);
        return { kind: 'ok' as const, rows };
      });
      if (result.kind === 'not_found') return reply.code(404).send({ error: 'sap_integration_connection_not_found' });
      return {
        servicePrincipals: result.rows.map((row) => ({
          id: row.id,
          clientId: row.client_id,
          displayName: row.display_name,
          allowedSourceKeys: row.allowed_source_keys,
          status: row.status,
          lastUsedAt: row.last_used_at?.toISOString() ?? null,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
        })),
      };
    },
  );

  app.post(
    '/api/v1/integrations/sap/connections/:connectionId/service-principals',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = connectionParams.safeParse(request.params);
      const body = servicePrincipalBody.safeParse(request.body);
      if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      if (!isTenantAdministrator(actor)) return reply.code(403).send({ error: 'tenant_admin_required' });
      const result = await withTenant(actor.tenantId, async (tx) => {
        const connection = await requireSapConnection(tx, actor.tenantId, params.data.connectionId);
        if (!connection) return { kind: 'not_found' as const };
        const knownSources = await tx.$queryRaw<Array<{ source_key: string }>>(Prisma.sql`
          SELECT source_key FROM integration_sources
          WHERE tenant_id = ${actor.tenantId}::uuid
            AND integration_connection_id = ${connection.id}::uuid
            AND is_active = true
        `);
        const known = new Set(knownSources.map((row) => row.source_key));
        const unknown = body.data.allowedSourceKeys.filter((key) => !known.has(key));
        if (unknown.length > 0) return { kind: 'unknown_sources' as const, unknown };
        const allowedSourceKeysSql = Prisma.sql`ARRAY[${Prisma.join(body.data.allowedSourceKeys)}]::text[]`;
        const rows = await tx.$queryRaw<ServicePrincipalRow[]>(Prisma.sql`
          INSERT INTO integration_service_principals
            (tenant_id, integration_connection_id, client_id, display_name,
             allowed_source_keys, status, updated_at)
          VALUES
            (${actor.tenantId}::uuid, ${connection.id}::uuid, ${body.data.clientId}::uuid,
             ${body.data.displayName}, ${allowedSourceKeysSql}, 'ACTIVE', CURRENT_TIMESTAMP)
          ON CONFLICT (tenant_id, client_id)
          DO UPDATE SET
            integration_connection_id = EXCLUDED.integration_connection_id,
            display_name = EXCLUDED.display_name,
            allowed_source_keys = EXCLUDED.allowed_source_keys,
            status = 'ACTIVE',
            updated_at = CURRENT_TIMESTAMP
          RETURNING id, client_id::text, display_name, allowed_source_keys, status,
                    last_used_at, created_at, updated_at
        `);
        const principal = rows[0]!;
        await tx.auditLog.create({
          data: {
            tenantId: actor.tenantId,
            userId: actor.userId,
            action: 'INTEGRATION_SERVICE_PRINCIPAL_UPSERTED',
            resource: 'INTEGRATION_SERVICE_PRINCIPAL',
            resourceId: principal.id,
            correlationId: request.id,
            ipAddress: request.ip,
            details: {
              provider: 'SAP',
              connectionId: connection.id,
              clientId: principal.client_id,
              allowedSourceKeys: principal.allowed_source_keys,
            },
          },
        });
        return { kind: 'ok' as const, principal };
      });
      if (result.kind === 'not_found') return reply.code(404).send({ error: 'sap_integration_connection_not_found' });
      if (result.kind === 'unknown_sources') return reply.code(400).send({ error: 'unknown_integration_sources', sourceKeys: result.unknown });
      return reply.code(201).send({
        id: result.principal.id,
        clientId: result.principal.client_id,
        displayName: result.principal.display_name,
        allowedSourceKeys: result.principal.allowed_source_keys,
        status: result.principal.status,
      });
    },
  );

  // Reserved for V1-B: non-interactive Entra client-credentials authentication will
  // resolve integration_service_principals and authorize only its allowed source keys.
  app.get(
    '/api/v1/integrations/sap/foundation-capabilities',
    { preHandler: [authenticate, resolveActor] },
    async (_request, _reply) => ({
    version: 'v1a',
    provider: 'SAP',
    sourceAgnostic: true,
    fileNameIsIdentity: false,
    originalBinaryRetention: true,
    checksumAlgorithm: 'SHA-256',
    idempotency: 'tenant+source+sha256',
    servicePrincipalFoundation: true,
      servicePrincipalAuthenticationEnabled: true,
      servicePrincipalOrchestrationEnabled: true,
    }),
  );
}
