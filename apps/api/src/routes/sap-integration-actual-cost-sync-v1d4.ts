import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { isTenantAdministrator } from '../authorization.js';
import {
  buildSapActualCostSyncPlanV1d4,
  type SapActualCostProjectionV1d4,
  type SapActualCostSourceRecordV1d4,
  type SapActualCostWbsMappingV1d4,
} from '../domain/sap-actual-cost-sync-v1d4.js';
import { withTenant } from '../tenant-transaction.js';
import { projectCostCurrency, validProject, validWorkItem } from './cost-engine-v2-utils.js';

const paramsSchema = z.object({ connectionId: z.string().uuid() });
const bodySchema = z.object({ dryRun: z.boolean().default(true) });

type LatestRecordRow = {
  id: string;
  external_key: string | null;
  normalized_payload: Prisma.JsonValue | null;
};
type MappingRow = {
  external_key: string;
  canonical_entity_id: string;
  metadata: Prisma.JsonValue | null;
  workspace_id: string;
};
type LinkRow = { canonical_entity_id: string; canonical_entity_type: string };
type ActualRow = {
  id: string;
  workspace_id: string;
  project_object_id: string;
  work_item_object_id: string | null;
  cost_code_id: string | null;
  material_id: string | null;
  description: string;
  amount: Prisma.Decimal | string | number;
  currency: string;
  occurred_at: Date;
};
type PreparedProjection = {
  projection: SapActualCostProjectionV1d4;
  existingActual: ActualRow | null;
};

type Counters = {
  inserted: number;
  updated: number;
  unchanged: number;
  projectsActivated: number;
  aggregateProjectionsApplied: number;
  exactFiLinesApplied: number;
};

type Blocker = { recordId: string; code: string; details?: Record<string, unknown> };

function jsonObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return null;
}

function workItemFromMetadata(value: Prisma.JsonValue | null): string | null {
  const metadata = jsonObject(value);
  return typeof metadata.workItemId === 'string' ? metadata.workItemId : null;
}

function numberOf(value: Prisma.Decimal | string | number): number {
  return Number(value);
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function loadLatestActualRecords(
  tx: Prisma.TransactionClient,
  tenantId: string,
  connectionId: string,
): Promise<SapActualCostSourceRecordV1d4[]> {
  const rows = await tx.$queryRaw<LatestRecordRow[]>(Prisma.sql`
    WITH latest_batch AS (
      SELECT id FROM (
        SELECT b.id,
               ROW_NUMBER() OVER (
                 PARTITION BY s.id
                 ORDER BY COALESCE(b.source_generated_at, b.received_at) DESC,
                          b.received_at DESC,
                          b.id DESC
               ) AS rn
        FROM integration_sources s
        JOIN integration_import_batches b
          ON b.integration_source_id = s.id
         AND b.tenant_id = s.tenant_id
        WHERE s.tenant_id = ${tenantId}::uuid
          AND s.integration_connection_id = ${connectionId}::uuid
          AND s.source_key = 'SAP_PROJECT_ACTUAL_COSTS'
          AND s.is_active = true
          AND b.status IN ('SUCCEEDED','PARTIAL')
      ) ranked
      WHERE rn = 1
    )
    SELECT r.id, r.external_key, r.normalized_payload
    FROM latest_batch lb
    JOIN integration_import_records r ON r.batch_id = lb.id
    WHERE r.tenant_id = ${tenantId}::uuid
      AND r.validation_status <> 'INVALID'
      AND r.processing_status <> 'FAILED'
    ORDER BY r.row_number
  `);
  return rows.map((row) => ({
    id: row.id,
    externalKey: row.external_key,
    normalized: jsonObject(row.normalized_payload),
  }));
}

async function loadWbsMappings(
  tx: Prisma.TransactionClient,
  tenantId: string,
  connectionId: string,
): Promise<SapActualCostWbsMappingV1d4[]> {
  const rows = await tx.$queryRaw<MappingRow[]>(Prisma.sql`
    SELECT link.external_key,
           link.canonical_entity_id,
           link.metadata,
           project.workspace_id
    FROM integration_entity_links link
    JOIN nexus_objects project
      ON project.id = link.canonical_entity_id
     AND project.tenant_id = link.tenant_id
    WHERE link.tenant_id = ${tenantId}::uuid
      AND link.integration_connection_id = ${connectionId}::uuid
      AND link.external_entity_type = 'SAP_WBS_ELEMENT'
      AND link.canonical_entity_type = 'PROJECT_OBJECT'
      AND project.object_type_key = 'PROJECT'
      AND project.deleted_at IS NULL
      AND link.external_key LIKE 'WBS:%'
    ORDER BY link.external_key
  `);
  return rows.map((row) => ({
    wbsElement: row.external_key.slice(4),
    projectId: row.canonical_entity_id,
    workspaceId: row.workspace_id,
    workItemId: workItemFromMetadata(row.metadata),
  }));
}

async function findEntityLink(
  tx: Prisma.TransactionClient,
  tenantId: string,
  connectionId: string,
  externalType: string,
  externalKey: string,
): Promise<LinkRow | null> {
  const rows = await tx.$queryRaw<LinkRow[]>(Prisma.sql`
    SELECT canonical_entity_id, canonical_entity_type
    FROM integration_entity_links
    WHERE tenant_id = ${tenantId}::uuid
      AND integration_connection_id = ${connectionId}::uuid
      AND external_entity_type = ${externalType}
      AND external_key = ${externalKey}
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function saveEntityLink(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    connectionId: string;
    sourceRecordId: string | null;
    externalType: string;
    externalKey: string;
    canonicalType: string;
    canonicalId: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO integration_entity_links
      (tenant_id, integration_connection_id, source_record_id,
       external_entity_type, external_key, canonical_entity_type, canonical_entity_id,
       metadata, last_seen_at, updated_at)
    VALUES
      (${input.tenantId}::uuid, ${input.connectionId}::uuid, ${input.sourceRecordId ?? null}::uuid,
       ${input.externalType}, ${input.externalKey}, ${input.canonicalType}, ${input.canonicalId}::uuid,
       ${JSON.stringify(input.metadata)}::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (tenant_id, integration_connection_id, external_entity_type, external_key)
    DO UPDATE SET source_record_id = EXCLUDED.source_record_id,
                  canonical_entity_type = EXCLUDED.canonical_entity_type,
                  canonical_entity_id = EXCLUDED.canonical_entity_id,
                  metadata = EXCLUDED.metadata,
                  last_seen_at = CURRENT_TIMESTAMP,
                  updated_at = CURRENT_TIMESTAMP
  `);
}

async function findActualByLink(
  tx: Prisma.TransactionClient,
  tenantId: string,
  connectionId: string,
  projection: SapActualCostProjectionV1d4,
): Promise<{ actual: ActualRow | null; conflict: string | null }> {
  const link = await findEntityLink(
    tx,
    tenantId,
    connectionId,
    'SAP_ACTUAL_COST_PROJECTION',
    projection.externalKey,
  );
  if (!link) return { actual: null, conflict: null };
  if (link.canonical_entity_type !== 'PROJECT_ACTUAL_COST') {
    return { actual: null, conflict: 'ACTUAL_COST_IDENTITY_LINK_CONFLICT' };
  }
  const rows = await tx.$queryRaw<ActualRow[]>(Prisma.sql`
    SELECT id, workspace_id, project_object_id, work_item_object_id, cost_code_id, material_id,
           description, amount, currency, occurred_at
    FROM project_actual_costs
    WHERE tenant_id = ${tenantId}::uuid
      AND id = ${link.canonical_entity_id}::uuid
    LIMIT 1
  `);
  if (!rows[0]) return { actual: null, conflict: 'ACTUAL_COST_LINK_TARGET_MISSING' };
  if (rows[0].project_object_id !== projection.projectId) {
    return { actual: null, conflict: 'ACTUAL_COST_PROJECT_IDENTITY_CONFLICT' };
  }
  return { actual: rows[0], conflict: null };
}

async function lockProjection(
  tx: Prisma.TransactionClient,
  tenantId: string,
  connectionId: string,
  externalKey: string,
): Promise<void> {
  await tx.$executeRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`${tenantId}:${connectionId}:SAP_ACTUAL:${externalKey}`}, 0)
    )
  `);
}

async function findMaterialId(
  tx: Prisma.TransactionClient,
  tenantId: string,
  workspaceId: string,
  materialCode: string | null,
): Promise<string | null> {
  if (!materialCode) return null;
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM material_masters
    WHERE tenant_id = ${tenantId}::uuid
      AND workspace_id = ${workspaceId}::uuid
      AND code = ${materialCode}
      AND is_active = true
    LIMIT 1
  `);
  return rows[0]?.id ?? null;
}

async function ensureSapCostCode(
  tx: Prisma.TransactionClient,
  tenantId: string,
  workspaceId: string,
  projection: SapActualCostProjectionV1d4,
): Promise<string | null> {
  if (!projection.costElement) return null;
  const code = `SAP-${projection.costElement}`.slice(0, 80);
  const existing = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM cost_codes
    WHERE tenant_id = ${tenantId}::uuid
      AND workspace_id = ${workspaceId}::uuid
      AND code = ${code}
    LIMIT 1
  `);
  if (existing[0]) return existing[0].id;
  const created = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    INSERT INTO cost_codes
      (tenant_id, workspace_id, code, name, category, is_active, updated_at)
    VALUES
      (${tenantId}::uuid, ${workspaceId}::uuid, ${code},
       ${(projection.costElementName ?? `Clase de coste SAP ${projection.costElement}`).slice(0, 255)},
       ${projection.materialCode ? 'MATERIAL' : 'OTHER'}, true, CURRENT_TIMESTAMP)
    RETURNING id
  `);
  return created[0]!.id;
}

function sameDate(left: Date, isoDate: string): boolean {
  return left.toISOString().slice(0, 10) === isoDate;
}

function descriptionFor(projection: SapActualCostProjectionV1d4): string {
  return (
    projection.materialDescription
    ?? projection.costElementName
    ?? `Costo real SAP ${projection.accountingDocument}`
  ).slice(0, 500);
}

async function markRecordsApplied(
  tx: Prisma.TransactionClient,
  tenantId: string,
  sourceRecordIds: string[],
): Promise<void> {
  for (const id of sourceRecordIds) {
    await tx.$executeRaw(Prisma.sql`
      UPDATE integration_import_records
      SET processing_status = 'APPLIED', updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid
    `);
  }
}

export async function sapIntegrationActualCostSyncV1d4Routes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/v1/integrations/sap/connections/:connectionId/actual-cost-sync-v1d4',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      const body = bodySchema.safeParse(request.body ?? {});
      if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      if (!isTenantAdministrator(actor)) return reply.code(403).send({ error: 'tenant_admin_required' });

      const result = await withTenant(actor.tenantId, async (tx) => {
        const connection = await tx.integrationConnection.findFirst({
          where: { id: params.data.connectionId, tenantId: actor.tenantId, provider: 'SAP' },
          select: { id: true, status: true },
        });
        if (!connection) return { kind: 'not_found' as const };
        if (connection.status === 'DISCONNECTED') return { kind: 'disconnected' as const };

        const [records, mappings] = await Promise.all([
          loadLatestActualRecords(tx, actor.tenantId, connection.id),
          loadWbsMappings(tx, actor.tenantId, connection.id),
        ]);
        const plan = buildSapActualCostSyncPlanV1d4(records, mappings);
        const blockers: Blocker[] = [...plan.blockers];
        const blockedProjects = new Set<string>();
        const prepared: PreparedProjection[] = [];

        for (const projection of plan.projections) {
          const project = await validProject(tx, actor.tenantId, projection.projectId);
          if (!project || project.workspaceId !== projection.workspaceId) {
            blockers.push({ recordId: projection.sourceRecordIds[0]!, code: 'WBS_PROJECT_MAPPING_STALE' });
            blockedProjects.add(projection.projectId);
            continue;
          }
          if (!(await validWorkItem(
            tx,
            actor.tenantId,
            projection.workspaceId,
            projection.projectId,
            projection.workItemId,
          ))) {
            blockers.push({ recordId: projection.sourceRecordIds[0]!, code: 'WBS_WORK_ITEM_MAPPING_STALE' });
            blockedProjects.add(projection.projectId);
            continue;
          }
          const projectCurrency = await projectCostCurrency(tx, actor.tenantId, projection.projectId);
          if (projectCurrency !== projection.currency) {
            blockers.push({
              recordId: projection.sourceRecordIds[0]!,
              code: 'PROJECT_COST_CURRENCY_MISMATCH',
              details: { projectCurrency, sapCurrency: projection.currency },
            });
            blockedProjects.add(projection.projectId);
            continue;
          }
          const existing = await findActualByLink(tx, actor.tenantId, connection.id, projection);
          if (existing.conflict) {
            blockers.push({ recordId: projection.sourceRecordIds[0]!, code: existing.conflict });
            blockedProjects.add(projection.projectId);
            continue;
          }
          prepared.push({ projection, existingActual: existing.actual });
        }

        const eligibleProjects = [...new Set(prepared.map((item) => item.projection.projectId))]
          .filter((projectId) => !blockedProjects.has(projectId));
        const eligible = prepared.filter((item) => eligibleProjects.includes(item.projection.projectId));

        if (body.data.dryRun) {
          return {
            kind: 'ok' as const,
            dryRun: true,
            plan,
            blockers,
            eligibleProjects,
            counters: {
              inserted: 0,
              updated: 0,
              unchanged: 0,
              projectsActivated: 0,
              aggregateProjectionsApplied: 0,
              exactFiLinesApplied: 0,
            } satisfies Counters,
          };
        }

        const counters: Counters = {
          inserted: 0,
          updated: 0,
          unchanged: 0,
          projectsActivated: 0,
          aggregateProjectionsApplied: 0,
          exactFiLinesApplied: 0,
        };

        for (const item of eligible.sort((a, b) => a.projection.externalKey.localeCompare(b.projection.externalKey))) {
          const projection = item.projection;
          await lockProjection(tx, actor.tenantId, connection.id, projection.externalKey);
          const costCodeId = await ensureSapCostCode(tx, actor.tenantId, projection.workspaceId, projection);
          const materialId = await findMaterialId(
            tx,
            actor.tenantId,
            projection.workspaceId,
            projection.materialCode,
          );
          const description = descriptionFor(projection);
          let actualId: string;

          if (!item.existingActual) {
            const created = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
              INSERT INTO project_actual_costs
                (tenant_id, workspace_id, project_object_id, work_item_object_id, cost_code_id,
                 material_id, description, amount, currency, source_type, external_reference,
                 occurred_at, notes, created_by_user_id)
              VALUES
                (${actor.tenantId}::uuid, ${projection.workspaceId}::uuid, ${projection.projectId}::uuid,
                 ${projection.workItemId ?? null}::uuid, ${costCodeId}::uuid, ${materialId}::uuid,
                 ${description}, ${projection.amount}, ${projection.currency}, 'SAP_IMPORT',
                 ${`SAP_DATA_PEP:${projection.externalKey}`}, ${new Date(`${projection.postingDate}T00:00:00.000Z`)},
                 ${`DATA PEP ${projection.identityMode}; documento ${projection.accountingDocument}`},
                 ${actor.userId}::uuid)
              RETURNING id
            `);
            actualId = created[0]!.id;
            counters.inserted += 1;
          } else {
            actualId = item.existingActual.id;
            const unchanged =
              item.existingActual.workspace_id === projection.workspaceId
              && item.existingActual.project_object_id === projection.projectId
              && item.existingActual.work_item_object_id === projection.workItemId
              && item.existingActual.cost_code_id === costCodeId
              && item.existingActual.material_id === materialId
              && item.existingActual.description === description
              && Math.abs(numberOf(item.existingActual.amount) - projection.amount) < 0.00005
              && item.existingActual.currency === projection.currency
              && sameDate(item.existingActual.occurred_at, projection.postingDate);
            if (unchanged) {
              counters.unchanged += 1;
            } else {
              await tx.$executeRaw(Prisma.sql`
                UPDATE project_actual_costs
                SET work_item_object_id = ${projection.workItemId ?? null}::uuid,
                    cost_code_id = ${costCodeId}::uuid,
                    material_id = ${materialId}::uuid,
                    description = ${description},
                    amount = ${projection.amount},
                    currency = ${projection.currency},
                    source_type = 'SAP_IMPORT',
                    external_reference = ${`SAP_DATA_PEP:${projection.externalKey}`},
                    occurred_at = ${new Date(`${projection.postingDate}T00:00:00.000Z`)},
                    notes = ${`DATA PEP ${projection.identityMode}; documento ${projection.accountingDocument}`}
                WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${actualId}::uuid
              `);
              counters.updated += 1;
            }
          }

          await saveEntityLink(tx, {
            tenantId: actor.tenantId,
            connectionId: connection.id,
            sourceRecordId: projection.sourceRecordIds[0] ?? null,
            externalType: 'SAP_ACTUAL_COST_PROJECTION',
            externalKey: projection.externalKey,
            canonicalType: 'PROJECT_ACTUAL_COST',
            canonicalId: actualId,
            metadata: {
              source: 'SAP_DATA_PEP',
              version: 'v1d4',
              identityMode: projection.identityMode,
              wbsElement: projection.wbsElement,
              accountingDocument: projection.accountingDocument,
              companyCode: projection.companyCode,
              fiscalYear: projection.fiscalYear,
              accountingDocumentItem: projection.accountingDocumentItem,
              sourceRecordCount: projection.sourceRecordIds.length,
              sourceRecordIds: projection.sourceRecordIds.slice(0, 50),
            },
          });
          await markRecordsApplied(tx, actor.tenantId, projection.sourceRecordIds);
          if (projection.identityMode === 'EXACT_FI_LINE') counters.exactFiLinesApplied += 1;
          else counters.aggregateProjectionsApplied += 1;
        }

        for (const projectId of eligibleProjects) {
          await saveEntityLink(tx, {
            tenantId: actor.tenantId,
            connectionId: connection.id,
            sourceRecordId: null,
            externalType: 'SAP_ACTUAL_COST_AUTHORITY',
            externalKey: `PROJECT:${projectId}`,
            canonicalType: 'PROJECT_OBJECT',
            canonicalId: projectId,
            metadata: {
              authority: 'SAP_DATA_PEP',
              version: 'v1d4',
              materialReceiptActualsSuppressed: true,
              activationPolicy: 'PROJECT_ALL_OR_NOTHING',
            },
          });
          counters.projectsActivated += 1;
        }

        await tx.auditLog.create({
          data: {
            tenantId: actor.tenantId,
            userId: actor.userId,
            action: 'SAP_ACTUAL_COST_SYNC_V1D4_APPLIED',
            resource: 'INTEGRATION_CONNECTION',
            resourceId: connection.id,
            correlationId: request.id,
            ipAddress: request.ip,
            details: toInputJson({ counters, blockers: blockers.slice(0, 100), eligibleProjects }),
          },
        });
        await tx.domainEvent.create({
          data: {
            tenantId: actor.tenantId,
            aggregateId: connection.id,
            eventType: 'bridata.integration.sap.actual-cost.v1d4.applied',
            payload: {
              connectionId: connection.id,
              counters,
              blocked: blockers.length,
              actualAuthority: 'SAP_DATA_PEP',
              actorId: actor.userId,
            },
          },
        });

        return { kind: 'ok' as const, dryRun: false, plan, blockers, eligibleProjects, counters };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'sap_integration_connection_not_found' });
      if (result.kind === 'disconnected') return reply.code(409).send({ error: 'sap_integration_connection_disconnected' });
      return reply.send({
        version: 'v1d4',
        canonicalDatabase: 'BRIDATA_POSTGRESQL',
        actualAuthority: 'SAP_DATA_PEP',
        materialReceiptActualsSuppressedWhenAuthorityActive: true,
        ...result,
      });
    },
  );
}
