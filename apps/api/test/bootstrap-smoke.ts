import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';

const DEV_TENANT_ID = '00000000-0000-4000-8000-000000000002';
const DEV_WORKSPACE_ID = '00000000-0000-4000-8000-000000000003';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const app = await buildApp();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: {
        'x-correlation-id': 'ci-bootstrap-smoke',
      },
    });

    assert(response.statusCode === 200, `Bootstrap returned ${response.statusCode}: ${response.body}`);

    const payload = response.json() as {
      product?: { name?: string; apiVersion?: string };
      actor?: { tenantId?: string };
      tenant?: { id?: string; name?: string };
      workspaces?: Array<{ id?: string }>;
      objectDefinitions?: Array<{ key?: string }>;
    };

    assert(payload.product?.name === 'Bridata Project', 'Bootstrap product name mismatch.');
    assert(payload.product.apiVersion === 'v1', 'Bootstrap API version mismatch.');
    assert(payload.actor?.tenantId === DEV_TENANT_ID, 'Bootstrap actor tenant mismatch.');
    assert(payload.tenant?.id === DEV_TENANT_ID, 'Bootstrap tenant mismatch.');
    assert(
      payload.workspaces?.some((workspace) => workspace.id === DEV_WORKSPACE_ID),
      'Bootstrap does not include the seeded DEV workspace.',
    );
    assert(
      payload.objectDefinitions?.some((definition) => definition.key === 'PROJECT'),
      'Bootstrap does not include PROJECT definition.',
    );
    assert(
      payload.objectDefinitions?.some((definition) => definition.key === 'TASK'),
      'Bootstrap does not include TASK definition.',
    );

    console.info(
      JSON.stringify({
        bootstrap: 'PASS',
        product: payload.product.name,
        tenant: payload.tenant?.name,
        workspaces: payload.workspaces?.length ?? 0,
        definitions: payload.objectDefinitions?.length ?? 0,
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
