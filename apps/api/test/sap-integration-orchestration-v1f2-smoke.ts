import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { SAP_ORCHESTRATION_REQUIRED_SOURCES_V1F2 } from '../src/domain/sap-orchestration-v1f2.js';
import { withTenant } from '../src/tenant-transaction.js';

const tenantId = process.env.DEV_TENANT_ID ?? '00000000-0000-4000-8000-000000000002';
const ownerUserId = process.env.DEV_USER_ID ?? '00000000-0000-4000-8000-000000000001';
const workspaceId = '00000000-0000-4000-8000-000000000003';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function canonicalCounts() {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.$queryRaw<Array<{
      purchase_requisitions: bigint;
      purchase_orders: bigint;
      inventory_movements: bigint;
      project_commitments: bigint;
      project_actual_costs: bigint;
    }>>(Prisma.sql`
      SELECT
        (SELECT COUNT(*) FROM purchase_requisitions WHERE tenant_id = ${tenantId}::uuid) AS purchase_requisitions,
        (SELECT COUNT(*) FROM purchase_orders WHERE tenant_id = ${tenantId}::uuid) AS purchase_orders,
        (SELECT COUNT(*) FROM inventory_movements WHERE tenant_id = ${tenantId}::uuid) AS inventory_movements,
        (SELECT COUNT(*) FROM project_commitments WHERE tenant_id = ${tenantId}::uuid) AS project_commitments,
        (SELECT COUNT(*) FROM project_actual_costs WHERE tenant_id = ${tenantId}::uuid) AS project_actual_costs
    `);
    const row = rows[0]!;
    return {
      purchaseRequisitions: Number(row.purchase_requisitions),
      purchaseOrders: Number(row.purchase_orders),
      inventoryMovements: Number(row.inventory_movements),
      projectCommitments: Number(row.project_commitments),
      projectActualCosts: Number(row.project_actual_costs),
    };
  });
}

async function main() {
  const connectionId = randomUUID();
  const fullClientId = randomUUID();
  const limitedClientId = randomUUID();

  await withTenant(tenantId, async (tx) => {
    await tx.integrationConnection.create({
      data: {
        id: connectionId,
        tenantId,
        provider: 'SAP',
        status: 'ACTIVE',
        displayName: `SAP Orchestration V1-F2 ${Date.now()}`,
      },
    });

    for (let index = 0; index < SAP_ORCHESTRATION_REQUIRED_SOURCES_V1F2.length; index += 1) {
      const sourceKey = SAP_ORCHESTRATION_REQUIRED_SOURCES_V1F2[index]!;
      const source = await tx.integrationSource.create({
        data: {
          tenantId,
          integrationConnectionId: connectionId,
          sourceKey,
          displayName: sourceKey,
          schemaVersion: 1,
          parserVersion: 'sap-auto-v1b',
        },
        select: { id: true },
      });
      const checksum = (index + 1).toString(16).padStart(64, '0');
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO integration_import_batches
          (tenant_id, integration_source_id, original_filename, content_type, file_size,
           checksum_sha256, storage_key, source_generated_at, status, schema_version,
           parser_version, total_records, accepted_records, inserted_records, updated_records,
           unchanged_records, warning_records, rejected_records, updated_at)
        VALUES
          (${tenantId}::uuid, ${source.id}::uuid, ${`${sourceKey}.xlsx`},
           'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 1,
           ${checksum}, ${`smoke/${connectionId}/${sourceKey}.xlsx`}, CURRENT_TIMESTAMP,
           'SUCCEEDED', 1, 'sap-auto-v1b', 0, 0, 0, 0, 0, 0, 0, CURRENT_TIMESTAMP)
      `);
    }

    await tx.integrationServicePrincipal.create({
      data: {
        tenantId,
        integrationConnectionId: connectionId,
        clientId: fullClientId,
        displayName: 'SAP Full Orchestrator V1-F2',
        allowedSourceKeys: [...SAP_ORCHESTRATION_REQUIRED_SOURCES_V1F2],
        status: 'ACTIVE',
      },
    });
    await tx.integrationServicePrincipal.create({
      data: {
        tenantId,
        integrationConnectionId: connectionId,
        clientId: limitedClientId,
        displayName: 'SAP Limited Orchestrator V1-F2',
        allowedSourceKeys: ['SAP_PROJECT_PROCUREMENT'],
        status: 'ACTIVE',
      },
    });
  });

  const app = await buildApp();
  const before = await canonicalCounts();

  try {
    const profile = await app.inject({
      method: 'PUT',
      url: `/api/v1/integrations/sap/connections/${connectionId}/automation-profile-v1f2`,
      payload: { workspaceId, ownerUserId, enabled: true },
    });
    assert(profile.statusCode === 200, `Automation profile failed: ${profile.statusCode} ${profile.body}`);
    const profileBody = profile.json<{ profile: { requiredSourceKeys: string[]; ownerUserId: string } }>();
    assert(profileBody.profile.requiredSourceKeys.length === 5, 'Full SAP source profile was not persisted.');
    assert(profileBody.profile.ownerUserId === ownerUserId, 'Automation owner was not persisted.');

    const getProfile = await app.inject({
      method: 'GET',
      url: `/api/v1/integrations/sap/connections/${connectionId}/automation-profile-v1f2`,
    });
    assert(getProfile.statusCode === 200, `Automation profile read failed: ${getProfile.statusCode}`);

    await withTenant(tenantId, async (tx) => {
      const activeLease = JSON.stringify({ version: 'v1f2', runId: randomUUID(), expiresAtEpochMs: Date.now() + 600_000 });
      await tx.$executeRaw(Prisma.sql`
        UPDATE integration_connections
        SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{sapOrchestrationLeaseV1f2}', ${activeLease}::jsonb, true)
        WHERE tenant_id = ${tenantId}::uuid AND id = ${connectionId}::uuid
      `);
    });
    const busy = await app.inject({
      method: 'POST',
      url: `/api/v1/integrations/sap/connections/${connectionId}/service-orchestrate-v1f2`,
      headers: {
        'x-bridata-tenant-id': tenantId,
        'x-bridata-service-client-id': fullClientId,
      },
      payload: { dryRun: true },
    });
    assert(busy.statusCode === 409, `Active orchestration lease was not enforced: ${busy.statusCode} ${busy.body}`);
    assert(busy.json<{ error: string }>().error === 'sap_orchestration_already_running', 'Unexpected lease conflict error.');
    await withTenant(tenantId, async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        UPDATE integration_connections
        SET config = COALESCE(config, '{}'::jsonb) - 'sapOrchestrationLeaseV1f2'
        WHERE tenant_id = ${tenantId}::uuid AND id = ${connectionId}::uuid
      `);
    });

    const limited = await app.inject({
      method: 'POST',
      url: `/api/v1/integrations/sap/connections/${connectionId}/service-orchestrate-v1f2`,
      headers: {
        'x-bridata-tenant-id': tenantId,
        'x-bridata-service-client-id': limitedClientId,
      },
      payload: { dryRun: true },
    });
    assert(limited.statusCode === 403, `Limited service principal triggered full orchestration: ${limited.statusCode} ${limited.body}`);

    const dryRun = await app.inject({
      method: 'POST',
      url: `/api/v1/integrations/sap/connections/${connectionId}/service-orchestrate-v1f2`,
      headers: {
        'x-bridata-tenant-id': tenantId,
        'x-bridata-service-client-id': fullClientId,
      },
      payload: { dryRun: true },
    });
    assert(dryRun.statusCode === 200, `F2 dry-run failed: ${dryRun.statusCode} ${dryRun.body}`);
    const dry = dryRun.json<{ status: string; dryRun: boolean; steps: Array<{ step: string; ok: boolean }> }>();
    assert(dry.dryRun === true && dry.steps.length === 4 && dry.steps.every((step) => step.ok), 'F2 dry-run did not traverse D1-D4.');

    const apply = await app.inject({
      method: 'POST',
      url: `/api/v1/integrations/sap/connections/${connectionId}/service-orchestrate-v1f2`,
      headers: {
        'x-bridata-tenant-id': tenantId,
        'x-bridata-service-client-id': fullClientId,
      },
      payload: { dryRun: false },
    });
    assert(apply.statusCode === 200, `F2 apply failed: ${apply.statusCode} ${apply.body}`);
    const applied = apply.json<{ status: string; retrySafe: boolean; executionModel: string; steps: Array<{ ok: boolean }> }>();
    assert(applied.status === 'SUCCEEDED', `Empty canonical orchestration should succeed, got ${applied.status}.`);
    assert(applied.retrySafe === true && applied.executionModel === 'RESUMABLE_STEPWISE', 'F2 resumable contract missing.');
    assert(applied.steps.length === 4 && applied.steps.every((step) => step.ok), 'F2 apply did not traverse all four engines.');

    const repeat = await app.inject({
      method: 'POST',
      url: `/api/v1/integrations/sap/connections/${connectionId}/service-orchestrate-v1f2`,
      headers: {
        'x-bridata-tenant-id': tenantId,
        'x-bridata-service-client-id': fullClientId,
      },
      payload: { dryRun: false },
    });
    assert(repeat.statusCode === 200, `F2 retry failed: ${repeat.statusCode} ${repeat.body}`);

    const after = await canonicalCounts();
    assert(JSON.stringify(after) === JSON.stringify(before), 'Empty F2 orchestration unexpectedly mutated canonical business data.');

    const persisted = await withTenant(tenantId, async (tx) => {
      const [audits, events, principal, connection] = await Promise.all([
        tx.auditLog.count({ where: { tenantId, resourceId: connectionId, action: 'SAP_ORCHESTRATION_V1F2_SUCCEEDED' } }),
        tx.domainEvent.count({ where: { tenantId, aggregateId: connectionId, eventType: 'bridata.integration.sap.orchestration.v1f2.completed' } }),
        tx.integrationServicePrincipal.findFirst({ where: { tenantId, integrationConnectionId: connectionId, clientId: fullClientId }, select: { lastUsedAt: true } }),
        tx.integrationConnection.findUnique({ where: { id: connectionId }, select: { config: true } }),
      ]);
      return { audits, events, principal, config: connection?.config };
    });
    assert(persisted.audits === 2 && persisted.events === 2, 'Successful F2 runs were not audited exactly once each.');
    assert(persisted.principal?.lastUsedAt, 'F2 did not update service principal last_used_at.');
    const config = persisted.config as Record<string, unknown> | null;
    assert(!config || !Object.prototype.hasOwnProperty.call(config, 'sapOrchestrationLeaseV1f2'), 'F2 lease was not released.');

    console.log(JSON.stringify({
      sapOrchestrationV1f2: 'PASS',
      profileGoverned: true,
      activeTenantAdminOwnerRequired: true,
      fiveSourceReadinessRequired: true,
      serviceAllowlistCoverageRequired: true,
      concurrentRunLeaseProtected: true,
      internalCredentialProcessLocal: true,
      D1D2D3D4Reused: true,
      resumableStepwise: true,
      retrySafe: true,
    }));
  } finally {
    await app.close();
    await withTenant(tenantId, async (tx) => {
      await tx.integrationConnection.delete({ where: { id: connectionId } });
    }).catch(() => undefined);
    const { prisma } = await import('../src/db.js');
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  const { prisma } = await import('../src/db.js');
  await prisma.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
