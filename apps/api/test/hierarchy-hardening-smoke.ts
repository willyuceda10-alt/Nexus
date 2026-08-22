import { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';

const TENANT_ID = '00000000-0000-4000-8000-000000000002';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000003';
const MISSING_PORTFOLIO_ID = '00000000-0000-4000-8000-000000009999';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const adminUrl = process.env.ADMIN_DATABASE_URL;
  if (!adminUrl) throw new Error('ADMIN_DATABASE_URL is required for hierarchy hardening smoke.');

  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const app = await buildApp();
  const createdIds: string[] = [];
  let rolesChanged = false;

  const restoreRoles = async () => {
    await admin.tenantMembership.update({
      where: { tenantId_userId: { tenantId: TENANT_ID, userId: USER_ID } },
      data: { role: 'OWNER' },
    });
    await admin.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: WORKSPACE_ID, userId: USER_ID } },
      data: { role: 'OWNER' },
    });
    rolesChanged = false;
  };

  try {
    const bootstrapResponse = await app.inject({ method: 'GET', url: '/api/v1/bootstrap' });
    assert(bootstrapResponse.statusCode === 200, `Bootstrap failed: ${bootstrapResponse.statusCode}`);
    const bootstrap = bootstrapResponse.json() as {
      objectDefinitions: Array<{ id: string; key: string }>;
    };
    const definition = (key: string) => bootstrap.objectDefinitions.find((item) => item.key === key)?.id;
    const portfolioDefinitionId = definition('PORTFOLIO');
    const programDefinitionId = definition('PROGRAM');
    const projectDefinitionId = definition('PROJECT');
    assert(portfolioDefinitionId && programDefinitionId && projectDefinitionId, 'Hierarchy definitions missing.');

    const create = async (payload: Record<string, unknown>, expectedStatus = 201) => {
      const response = await app.inject({ method: 'POST', url: '/api/v1/objects', payload });
      assert(response.statusCode === expectedStatus, `Expected ${expectedStatus}, got ${response.statusCode}: ${response.body}`);
      if (expectedStatus !== 201) return response.json() as Record<string, unknown>;
      const body = response.json() as { id: string; version: number; metadata: Record<string, unknown> | null };
      createdIds.push(body.id);
      return body;
    };

    const programWithoutPortfolio = await create({
      workspaceId: WORKSPACE_ID,
      objectDefinitionId: programDefinitionId,
      objectTypeKey: 'PROGRAM',
      title: 'Invalid program without portfolio',
      status: 'PLANNING',
      priority: 'MEDIUM',
      progress: 0,
      metadata: {},
    }, 400);
    assert(programWithoutPortfolio.error === 'invalid_hierarchy_metadata', 'Missing portfolioId was not rejected.');

    const missingPortfolio = await create({
      workspaceId: WORKSPACE_ID,
      objectDefinitionId: programDefinitionId,
      objectTypeKey: 'PROGRAM',
      title: 'Invalid missing portfolio',
      status: 'PLANNING',
      priority: 'MEDIUM',
      progress: 0,
      metadata: { portfolioId: MISSING_PORTFOLIO_ID },
    }, 404);
    assert(missingPortfolio.error === 'hierarchy_reference_not_found', 'Missing hierarchy reference was not rejected.');

    const portfolioA = await create({
      workspaceId: WORKSPACE_ID,
      objectDefinitionId: portfolioDefinitionId,
      objectTypeKey: 'PORTFOLIO',
      title: 'Hardening Portfolio A',
      status: 'PLANNING',
      priority: 'HIGH',
      progress: 0,
      metadata: { code: 'PORT-HARD-A' },
    }) as { id: string; version: number };

    const portfolioB = await create({
      workspaceId: WORKSPACE_ID,
      objectDefinitionId: portfolioDefinitionId,
      objectTypeKey: 'PORTFOLIO',
      title: 'Hardening Portfolio B',
      status: 'PLANNING',
      priority: 'HIGH',
      progress: 0,
      metadata: { code: 'PORT-HARD-B' },
    }) as { id: string; version: number };

    const programA = await create({
      workspaceId: WORKSPACE_ID,
      objectDefinitionId: programDefinitionId,
      objectTypeKey: 'PROGRAM',
      title: 'Hardening Program A',
      status: 'PLANNING',
      priority: 'HIGH',
      progress: 0,
      metadata: { portfolioId: portfolioA.id, code: 'PRG-HARD-A' },
    }) as { id: string; version: number };

    const mismatch = await create({
      workspaceId: WORKSPACE_ID,
      objectDefinitionId: projectDefinitionId,
      objectTypeKey: 'PROJECT',
      title: 'Invalid hierarchy project',
      status: 'PLANNING',
      priority: 'MEDIUM',
      progress: 0,
      metadata: { portfolioId: portfolioB.id, programId: programA.id },
    }, 409);
    assert(mismatch.error === 'hierarchy_mismatch', 'Program/portfolio mismatch was not rejected.');

    const projectA = await create({
      workspaceId: WORKSPACE_ID,
      objectDefinitionId: projectDefinitionId,
      objectTypeKey: 'PROJECT',
      title: 'Hardening Project A',
      status: 'PLANNING',
      priority: 'MEDIUM',
      progress: 0,
      metadata: { portfolioId: portfolioA.id, programId: programA.id, budgetTotal: 1000 },
    }) as { id: string; version: number };

    const moveResponse = await app.inject({
      method: 'PATCH',
      url: `/api/v1/objects/${programA.id}`,
      payload: {
        version: programA.version,
        metadata: { portfolioId: portfolioB.id, code: 'PRG-HARD-A' },
      },
    });
    assert(moveResponse.statusCode === 409, `Unsafe program move returned ${moveResponse.statusCode}.`);
    assert((moveResponse.json() as { error?: string }).error === 'hierarchy_mismatch', 'Unsafe program move error mismatch.');

    const deletePortfolioResponse = await app.inject({ method: 'DELETE', url: `/api/v1/objects/${portfolioA.id}` });
    assert(deletePortfolioResponse.statusCode === 409, `Portfolio with children delete returned ${deletePortfolioResponse.statusCode}.`);
    assert((deletePortfolioResponse.json() as { error?: string }).error === 'hierarchy_has_children', 'Portfolio delete protection mismatch.');

    const deleteProgramResponse = await app.inject({ method: 'DELETE', url: `/api/v1/objects/${programA.id}` });
    assert(deleteProgramResponse.statusCode === 409, `Program with children delete returned ${deleteProgramResponse.statusCode}.`);
    assert((deleteProgramResponse.json() as { error?: string }).error === 'hierarchy_has_children', 'Program delete protection mismatch.');

    await admin.tenantMembership.update({
      where: { tenantId_userId: { tenantId: TENANT_ID, userId: USER_ID } },
      data: { role: 'MEMBER' },
    });
    await admin.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: WORKSPACE_ID, userId: USER_ID } },
      data: { role: 'MEMBER' },
    });
    rolesChanged = true;

    const memberDenied = await create({
      workspaceId: WORKSPACE_ID,
      objectDefinitionId: portfolioDefinitionId,
      objectTypeKey: 'PORTFOLIO',
      title: 'Forbidden member portfolio',
      status: 'PLANNING',
      priority: 'MEDIUM',
      progress: 0,
      metadata: { code: 'PORT-FORBIDDEN' },
    }, 403);
    assert(memberDenied.error === 'hierarchy_management_denied', 'MEMBER hierarchy write was not denied.');

    await admin.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: WORKSPACE_ID, userId: USER_ID } },
      data: { role: 'MANAGER' },
    });

    const managerPortfolio = await create({
      workspaceId: WORKSPACE_ID,
      objectDefinitionId: portfolioDefinitionId,
      objectTypeKey: 'PORTFOLIO',
      title: 'Allowed manager portfolio',
      status: 'PLANNING',
      priority: 'MEDIUM',
      progress: 0,
      metadata: { code: 'PORT-MANAGER' },
    }) as { id: string; version: number };
    assert(managerPortfolio.id, 'Workspace MANAGER could not create hierarchy object.');

    await restoreRoles();

    console.info(JSON.stringify({
      hierarchyHardening: 'PASS',
      invalidReference: true,
      mismatchProtection: true,
      moveProtection: true,
      deleteProtection: true,
      memberDenied: true,
      managerAllowed: true,
      projectId: projectA.id,
    }));
  } finally {
    if (rolesChanged) await restoreRoles();
    for (const id of [...createdIds].reverse()) {
      await app.inject({ method: 'DELETE', url: `/api/v1/objects/${id}` });
    }
    await app.close();
    await prisma.$disconnect();
    await admin.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
