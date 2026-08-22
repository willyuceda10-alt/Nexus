import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';

const DEV_USER_ID = '00000000-0000-4000-8000-000000000001';
const DEV_TENANT_ID = '00000000-0000-4000-8000-000000000002';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const app = await buildApp();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/session',
      headers: {
        'x-correlation-id': 'ci-session-smoke',
      },
    });

    assert(response.statusCode === 200, `Session returned ${response.statusCode}: ${response.body}`);

    const payload = response.json() as {
      product?: { name?: string; apiVersion?: string };
      identity?: { provider?: string };
      user?: { id?: string; email?: string; fullName?: string };
      tenants?: Array<{ id?: string; membershipId?: string; role?: string }>;
      preferredTenantId?: string | null;
    };

    assert(payload.product?.name === 'Bridata Project', 'Session product name mismatch.');
    assert(payload.product.apiVersion === 'v1', 'Session API version mismatch.');
    assert(payload.identity?.provider === 'DEV', 'DEV session provider mismatch.');
    assert(payload.user?.id === DEV_USER_ID, 'Session resolved unexpected user.');
    assert(
      payload.tenants?.some((tenant) => tenant.id === DEV_TENANT_ID),
      'Session did not discover the authenticated user DEV tenant.',
    );
    assert(
      payload.tenants?.every((tenant) => Boolean(tenant.membershipId && tenant.role)),
      'Session tenant membership metadata is incomplete.',
    );
    assert(payload.preferredTenantId === DEV_TENANT_ID, 'Preferred tenant mismatch.');

    console.info(
      JSON.stringify({
        session: 'PASS',
        preTenantDiscovery: true,
        tenantCount: payload.tenants?.length ?? 0,
        preferredTenantId: payload.preferredTenantId,
      }),
    );
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
