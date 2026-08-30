import { randomUUID } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { isTenantAdministrator } from '../authorization.js';
import {
  SAP_ORCHESTRATION_REQUIRED_SOURCES_V1F2,
  mergeSapAutomationProfileV1f2,
  notReadySourcesV1f2,
  readSapAutomationProfileV1f2,
  servicePrincipalCoversProfileV1f2,
  type SapAutomationProfileV1f2,
} from '../domain/sap-orchestration-v1f2.js';
import {
  SAP_INTERNAL_ORCHESTRATION_HEADER_V1F2,
  SAP_INTERNAL_OWNER_HEADER_V1F2,
  sapInternalOrchestrationSecretV1f2,
} from '../internal-sap-orchestration-auth-v1f2.js';
import { authenticateSapIntegrationServiceV1f1 } from '../sap-integration-service-auth-v1f1.js';
import { withTenant } from '../tenant-transaction.js';

const paramsSchema = z.object({ connectionId: z.string().uuid() });
const profileBodySchema = z.object({
  workspaceId: z.string().uuid(),
  ownerUserId: z.string().uuid(),
  enabled: z.boolean().default(true),
});
const orchestrationBodySchema = z.object({ dryRun: z.boolean().default(false) });

type SourceStatusRow = { source_key: string; latest_status: string | null };
type LeaseRow = { id: string };

type CompactStepResult = {
  step: string;
  statusCode: number;
  ok: boolean;
  version?: string;
  blockerCount: number;
  summary?: unknown;
  counters?: unknown;
  preflight?: unknown;
  error?: unknown;
};

function jsonObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function responseJson(response: LightMyRequestResponse): Record<string, unknown> {
  try {
    const parsed = JSON.parse(response.body) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function compactStep(step: string, response: LightMyRequestResponse): CompactStepResult {
  const body = responseJson(response);
  const blockers = Array.isArray(body.blockers) ? body.blockers : [];
  return {
    step,
    statusCode: response.statusCode,
    ok: response.statusCode >= 200 && response.statusCode < 300,
    ...(typeof body.version === 'string' ? { version: body.version } : {}),
    blockerCount: blockers.length,
    ...(Object.prototype.hasOwnProperty.call(body, 'summary') ? { summary: body.summary } : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'counters') ? { counters: body.counters } : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'preflight') ? { preflight: body.preflight } : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'error') ? { error: body.error } : {}),
  };
}

async function sourceReadiness(tenantId: string, connectionId: string) {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.$queryRaw<SourceStatusRow[]>(Prisma.sql`
      SELECT s.source_key,
             latest.status AS latest_status
      FROM integration_sources s
      LEFT JOIN LATERAL (
        SELECT b.status
        FROM integration_import_batches b
        WHERE b.tenant_id = s.tenant_id
          AND b.integration_source_id = s.id
        ORDER BY b.received_at DESC, b.id DESC
        LIMIT 1
      ) latest ON true
      WHERE s.tenant_id = ${tenantId}::uuid
        AND s.integration_connection_id = ${connectionId}::uuid
        AND s.is_active = true
        AND s.source_key IN (${Prisma.join([...SAP_ORCHESTRATION_REQUIRED_SOURCES_V1F2])})
    `);
    return rows.map((row) => ({ sourceKey: row.source_key, latestStatus: row.latest_status }));
  });
}

async function loadRuntimeProfile(tenantId: string, connectionId: string): Promise<{
  profile: SapAutomationProfileV1f2 | null;
  connectionStatus: string | null;
  ownerValid: boolean;
  workspaceValid: boolean;
}> {
  return withTenant(tenantId, async (tx) => {
    const connection = await tx.integrationConnection.findFirst({
      where: { id: connectionId, tenantId, provider: 'SAP' },
      select: { status: true, config: true },
    });
    if (!connection) {
      return { profile: null, connectionStatus: null, ownerValid: false, workspaceValid: false };
    }
    const profile = readSapAutomationProfileV1f2(connection.config);
    if (!profile) {
      return { profile: null, connectionStatus: connection.status, ownerValid: false, workspaceValid: false };
    }
    const [workspace, membership] = await Promise.all([
      tx.workspace.findFirst({ where: { id: profile.workspaceId, tenantId }, select: { id: true } }),
      tx.tenantMembership.findUnique({
        where: { tenantId_userId: { tenantId, userId: profile.ownerUserId } },
        include: { user: { select: { isActive: true } } },
      }),
    ]);
    const ownerValid = Boolean(
      membership
      && membership.status === 'ACTIVE'
      && membership.user.isActive
      && (membership.role === 'OWNER' || membership.role === 'TENANT_ADMIN'),
    );
    return {
      profile,
      connectionStatus: connection.status,
      ownerValid,
      workspaceValid: Boolean(workspace),
    };
  });
}

async function acquireLease(tenantId: string, connectionId: string, runId: string): Promise<boolean> {
  const now = Date.now();
  const lease = JSON.stringify({
    version: 'v1f2',
    runId,
    acquiredAt: new Date(now).toISOString(),
    expiresAtEpochMs: now + 60 * 60 * 1000,
  });
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.$queryRaw<LeaseRow[]>(Prisma.sql`
      UPDATE integration_connections
      SET config = jsonb_set(
            COALESCE(config, '{}'::jsonb),
            '{sapOrchestrationLeaseV1f2}',
            ${lease}::jsonb,
            true
          ),
          updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${tenantId}::uuid
        AND id = ${connectionId}::uuid
        AND (
          config->'sapOrchestrationLeaseV1f2' IS NULL
          OR CASE
            WHEN jsonb_typeof(config->'sapOrchestrationLeaseV1f2'->'expiresAtEpochMs') = 'number'
              THEN (config->'sapOrchestrationLeaseV1f2'->>'expiresAtEpochMs')::bigint
            ELSE 0
          END < ${now}
        )
      RETURNING id
    `);
    return rows.length === 1;
  });
}

async function renewLease(tenantId: string, connectionId: string, runId: string): Promise<void> {
  const now = Date.now();
  const lease = JSON.stringify({
    version: 'v1f2',
    runId,
    acquiredAt: new Date(now).toISOString(),
    expiresAtEpochMs: now + 60 * 60 * 1000,
  });
  await withTenant(tenantId, async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      UPDATE integration_connections
      SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{sapOrchestrationLeaseV1f2}', ${lease}::jsonb, true),
          updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${tenantId}::uuid
        AND id = ${connectionId}::uuid
        AND config->'sapOrchestrationLeaseV1f2'->>'runId' = ${runId}
    `);
  });
}

async function releaseLease(tenantId: string, connectionId: string, runId: string): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      UPDATE integration_connections
      SET config = COALESCE(config, '{}'::jsonb) - 'sapOrchestrationLeaseV1f2',
          updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${tenantId}::uuid
        AND id = ${connectionId}::uuid
        AND config->'sapOrchestrationLeaseV1f2'->>'runId' = ${runId}
    `);
  });
}

export async function sapIntegrationOrchestrationV1f2Routes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/integrations/sap/connections/:connectionId/automation-profile-v1f2',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      if (!isTenantAdministrator(actor)) return reply.code(403).send({ error: 'tenant_admin_required' });
      const result = await withTenant(actor.tenantId, async (tx) => {
        const connection = await tx.integrationConnection.findFirst({
          where: { id: params.data.connectionId, tenantId: actor.tenantId, provider: 'SAP' },
          select: { config: true },
        });
        if (!connection) return null;
        return readSapAutomationProfileV1f2(connection.config);
      });
      if (!result) return reply.code(404).send({ error: 'sap_automation_profile_not_found' });
      return { version: 'v1f2', profile: result };
    },
  );

  app.put(
    '/api/v1/integrations/sap/connections/:connectionId/automation-profile-v1f2',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      const body = profileBodySchema.safeParse(request.body ?? {});
      if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      if (!isTenantAdministrator(actor)) return reply.code(403).send({ error: 'tenant_admin_required' });

      const profile: SapAutomationProfileV1f2 = {
        enabled: body.data.enabled,
        workspaceId: body.data.workspaceId,
        ownerUserId: body.data.ownerUserId,
        requiredSourceKeys: [...SAP_ORCHESTRATION_REQUIRED_SOURCES_V1F2],
      };
      const result = await withTenant(actor.tenantId, async (tx) => {
        const connection = await tx.integrationConnection.findFirst({
          where: { id: params.data.connectionId, tenantId: actor.tenantId, provider: 'SAP' },
          select: { id: true, config: true },
        });
        if (!connection) return { kind: 'not_found' as const };
        const [workspace, membership] = await Promise.all([
          tx.workspace.findFirst({ where: { id: profile.workspaceId, tenantId: actor.tenantId }, select: { id: true } }),
          tx.tenantMembership.findUnique({
            where: { tenantId_userId: { tenantId: actor.tenantId, userId: profile.ownerUserId } },
            include: { user: { select: { isActive: true } } },
          }),
        ]);
        if (!workspace) return { kind: 'workspace_invalid' as const };
        if (
          !membership
          || membership.status !== 'ACTIVE'
          || !membership.user.isActive
          || (membership.role !== 'OWNER' && membership.role !== 'TENANT_ADMIN')
        ) return { kind: 'owner_invalid' as const };

        const merged = mergeSapAutomationProfileV1f2(connection.config, profile);
        await tx.integrationConnection.update({
          where: { id: connection.id },
          data: { config: toInputJson(merged) },
        });
        await tx.auditLog.create({
          data: {
            tenantId: actor.tenantId,
            userId: actor.userId,
            action: 'SAP_AUTOMATION_PROFILE_V1F2_UPDATED',
            resource: 'INTEGRATION_CONNECTION',
            resourceId: connection.id,
            correlationId: request.id,
            ipAddress: request.ip,
            details: toInputJson(profile),
          },
        });
        return { kind: 'ok' as const };
      });
      if (result.kind === 'not_found') return reply.code(404).send({ error: 'sap_integration_connection_not_found' });
      if (result.kind === 'workspace_invalid') return reply.code(400).send({ error: 'sap_automation_workspace_invalid' });
      if (result.kind === 'owner_invalid') return reply.code(400).send({ error: 'sap_automation_owner_must_be_active_tenant_admin' });
      return { version: 'v1f2', profile };
    },
  );

  app.post(
    '/api/v1/integrations/sap/connections/:connectionId/service-orchestrate-v1f2',
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      const body = orchestrationBodySchema.safeParse(request.body ?? {});
      if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });

      const serviceActor = await authenticateSapIntegrationServiceV1f1(request, reply, params.data.connectionId);
      if (!serviceActor) return;
      const runtime = await loadRuntimeProfile(serviceActor.tenantId, serviceActor.connectionId);
      if (!runtime.profile) return reply.code(409).send({ error: 'sap_automation_profile_not_configured' });
      if (!runtime.profile.enabled) return reply.code(409).send({ error: 'sap_automation_profile_disabled' });
      if (runtime.connectionStatus === 'DISCONNECTED') return reply.code(409).send({ error: 'sap_integration_connection_disconnected' });
      if (!runtime.workspaceValid || !runtime.ownerValid) {
        return reply.code(409).send({ error: 'sap_automation_profile_stale' });
      }
      if (!servicePrincipalCoversProfileV1f2(serviceActor.allowedSourceKeys, runtime.profile.requiredSourceKeys)) {
        return reply.code(403).send({ error: 'integration_service_principal_does_not_cover_orchestration_sources' });
      }

      const readiness = await sourceReadiness(serviceActor.tenantId, serviceActor.connectionId);
      const notReady = notReadySourcesV1f2(runtime.profile.requiredSourceKeys, readiness);
      if (notReady.length > 0) {
        return reply.code(409).send({ error: 'sap_orchestration_sources_not_ready', sources: notReady });
      }

      const runId = randomUUID();
      if (!(await acquireLease(serviceActor.tenantId, serviceActor.connectionId, runId))) {
        return reply.code(409).send({ error: 'sap_orchestration_already_running' });
      }

      const steps: CompactStepResult[] = [];
      let failedStep: CompactStepResult | null = null;
      try {
        const headers = {
          'content-type': 'application/json',
          'x-bridata-tenant-id': serviceActor.tenantId,
          [SAP_INTERNAL_ORCHESTRATION_HEADER_V1F2]: sapInternalOrchestrationSecretV1f2(),
          [SAP_INTERNAL_OWNER_HEADER_V1F2]: runtime.profile.ownerUserId,
          'x-correlation-id': request.id,
        };
        const definitions = [
          {
            step: 'CANONICAL_PROCUREMENT_V1D1',
            url: `/api/v1/integrations/sap/connections/${serviceActor.connectionId}/canonical-sync-v1d1`,
            payload: { workspaceId: runtime.profile.workspaceId, dryRun: body.data.dryRun },
          },
          {
            step: 'INVENTORY_V1D2',
            url: `/api/v1/integrations/sap/connections/${serviceActor.connectionId}/inventory-sync-v1d2`,
            payload: { workspaceId: runtime.profile.workspaceId, dryRun: body.data.dryRun },
          },
          {
            step: 'FINANCIAL_GUARD_V1D3',
            url: `/api/v1/integrations/sap/connections/${serviceActor.connectionId}/financial-guard-v1d3`,
            payload: { dryRun: body.data.dryRun },
          },
          {
            step: 'ACTUAL_COST_V1D4',
            url: `/api/v1/integrations/sap/connections/${serviceActor.connectionId}/actual-cost-sync-v1d4`,
            payload: { dryRun: body.data.dryRun },
          },
        ];

        for (const definition of definitions) {
          const response = await app.inject({
            method: 'POST',
            url: definition.url,
            headers,
            payload: definition.payload,
          });
          const compact = compactStep(definition.step, response);
          steps.push(compact);
          await renewLease(serviceActor.tenantId, serviceActor.connectionId, runId);
          if (!compact.ok) {
            failedStep = compact;
            break;
          }
        }

        const blockerCount = steps.reduce((sum, step) => sum + step.blockerCount, 0);
        const status = failedStep ? 'FAILED' : blockerCount > 0 ? 'PARTIAL' : 'SUCCEEDED';
        await withTenant(serviceActor.tenantId, async (tx) => {
          await tx.integrationServicePrincipal.update({
            where: { id: serviceActor.servicePrincipalId },
            data: { lastUsedAt: new Date() },
          });
          await tx.auditLog.create({
            data: {
              tenantId: serviceActor.tenantId,
              userId: runtime.profile!.ownerUserId,
              action: `SAP_ORCHESTRATION_V1F2_${status}`,
              resource: 'INTEGRATION_CONNECTION',
              resourceId: serviceActor.connectionId,
              correlationId: request.id,
              ipAddress: request.ip,
              details: toInputJson({
                runId,
                dryRun: body.data.dryRun,
                servicePrincipalId: serviceActor.servicePrincipalId,
                serviceClientId: serviceActor.clientId,
                workspaceId: runtime.profile!.workspaceId,
                ownerUserId: runtime.profile!.ownerUserId,
                status,
                steps,
                resumable: true,
              }),
            },
          });
          await tx.domainEvent.create({
            data: {
              tenantId: serviceActor.tenantId,
              aggregateId: serviceActor.connectionId,
              eventType: 'bridata.integration.sap.orchestration.v1f2.completed',
              payload: toInputJson({
                runId,
                status,
                dryRun: body.data.dryRun,
                servicePrincipalId: serviceActor.servicePrincipalId,
                ownerUserId: runtime.profile!.ownerUserId,
                steps: steps.map((step) => ({ step: step.step, statusCode: step.statusCode, blockerCount: step.blockerCount })),
              }),
            },
          });
        });

        const response = {
          version: 'v1f2',
          runId,
          status,
          dryRun: body.data.dryRun,
          executionModel: 'RESUMABLE_STEPWISE',
          canonicalDatabase: 'BRIDATA_POSTGRESQL',
          workspaceId: runtime.profile.workspaceId,
          ownerUserId: runtime.profile.ownerUserId,
          servicePrincipalId: serviceActor.servicePrincipalId,
          steps,
          retrySafe: true,
        };
        return failedStep ? reply.code(424).send(response) : reply.send(response);
      } finally {
        await releaseLease(serviceActor.tenantId, serviceActor.connectionId, runId).catch(() => undefined);
      }
    },
  );
}
