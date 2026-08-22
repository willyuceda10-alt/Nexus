import { PrismaClient, type Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const TENANT_A = '00000000-0000-4000-8000-000000000002';
const TENANT_B = '00000000-0000-4000-8000-000000000022';
const WORKSPACE_B = '00000000-0000-4000-8000-000000000023';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function withTenant<T>(
  tenantId: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
    return operation(tx);
  });
}

async function main() {
  const visibleWithoutContext = await prisma.tenant.count();
  assert(
    visibleWithoutContext === 0,
    `RLS fail-closed check failed: expected 0 tenants without context, got ${visibleWithoutContext}`,
  );

  const tenantAVisible = await withTenant(TENANT_A, (tx) =>
    tx.tenant.count({ where: { id: TENANT_A } }),
  );
  assert(tenantAVisible === 1, 'Tenant A is not visible inside its own RLS context.');

  await withTenant(TENANT_B, async (tx) => {
    await tx.tenant.upsert({
      where: { id: TENANT_B },
      update: { status: 'ACTIVE' },
      create: {
        id: TENANT_B,
        name: 'Bridata RLS Smoke Tenant B',
        slug: 'bridata-rls-smoke-b',
        plan: 'ENTERPRISE',
        status: 'ACTIVE',
      },
    });

    await tx.workspace.upsert({
      where: { tenantId_code: { tenantId: TENANT_B, code: 'RLS-SMOKE' } },
      update: { name: 'RLS Smoke Workspace B' },
      create: {
        id: WORKSPACE_B,
        tenantId: TENANT_B,
        code: 'RLS-SMOKE',
        name: 'RLS Smoke Workspace B',
      },
    });
  });

  const tenantBVisibleFromA = await withTenant(TENANT_A, (tx) =>
    tx.workspace.count({ where: { id: WORKSPACE_B } }),
  );
  assert(
    tenantBVisibleFromA === 0,
    'Cross-tenant read isolation failed: Tenant A can see Tenant B workspace.',
  );

  let crossTenantWriteRejected = false;
  try {
    await withTenant(TENANT_A, (tx) =>
      tx.workspace.create({
        data: {
          tenantId: TENANT_B,
          code: 'ILLEGAL-CROSS-TENANT',
          name: 'This row must never be created',
        },
      }),
    );
  } catch {
    crossTenantWriteRejected = true;
  }

  assert(crossTenantWriteRejected, 'Cross-tenant write was not rejected by RLS.');

  console.info(
    JSON.stringify({
      rls: 'PASS',
      failClosedWithoutTenant: true,
      ownTenantVisible: true,
      crossTenantReadBlocked: true,
      crossTenantWriteBlocked: true,
    }),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
