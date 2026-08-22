import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';

const DEV_WORKSPACE_ID = '00000000-0000-4000-8000-000000000003';
const TASK_A = '00000000-0000-4000-8000-000000000102';
const TASK_B = '00000000-0000-4000-8000-000000000103';
const TASK_C = '00000000-0000-4000-8000-000000000104';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const app = await buildApp();
  const createdIds: string[] = [];

  try {
    const create = async (
      predecessorId: string,
      successorId: string,
      dependencyType: 'FS' | 'SS' | 'FF' | 'SF' = 'FS',
      lagDays = 0,
    ) => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/dependencies',
        headers: { 'x-correlation-id': `ci-dep-${predecessorId.slice(-3)}-${successorId.slice(-3)}` },
        payload: { predecessorId, successorId, dependencyType, lagDays },
      });
      assert(
        response.statusCode === 201,
        `Dependency create returned ${response.statusCode}: ${response.body}`,
      );
      const dependency = response.json() as {
        id: string;
        predecessorId: string;
        successorId: string;
        dependencyType: string;
        lagDays: number;
      };
      createdIds.push(dependency.id);
      return dependency;
    };

    const first = await create(TASK_A, TASK_B, 'FS', 1);
    assert(first.predecessorId === TASK_A, 'Predecessor normalization is incorrect.');
    assert(first.successorId === TASK_B, 'Successor normalization is incorrect.');
    assert(first.dependencyType === 'FS' && first.lagDays === 1, 'FS dependency metadata was not persisted.');

    const second = await create(TASK_B, TASK_C, 'SS', 2);
    assert(second.dependencyType === 'SS', 'SS dependency metadata was not persisted.');

    const duplicateResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/dependencies',
      headers: { 'x-correlation-id': 'ci-dep-duplicate' },
      payload: { predecessorId: TASK_A, successorId: TASK_B, dependencyType: 'FF', lagDays: 0 },
    });
    assert(
      duplicateResponse.statusCode === 409,
      `Duplicate dependency should return 409, got ${duplicateResponse.statusCode}.`,
    );

    const cycleResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/dependencies',
      headers: { 'x-correlation-id': 'ci-dep-cycle' },
      payload: { predecessorId: TASK_C, successorId: TASK_A, dependencyType: 'FS', lagDays: 0 },
    });
    assert(
      cycleResponse.statusCode === 409,
      `Cycle should return 409, got ${cycleResponse.statusCode}: ${cycleResponse.body}`,
    );
    const cycleBody = cycleResponse.json() as { error?: string };
    assert(cycleBody.error === 'dependency_cycle', 'Cycle rejection did not use dependency_cycle error code.');

    const patchResponse = await app.inject({
      method: 'PATCH',
      url: `/api/v1/dependencies/${first.id}`,
      headers: { 'x-correlation-id': 'ci-dep-patch' },
      payload: { dependencyType: 'FF', lagDays: -1, notes: 'CI lead validation' },
    });
    assert(
      patchResponse.statusCode === 200,
      `Dependency patch returned ${patchResponse.statusCode}: ${patchResponse.body}`,
    );
    const patched = patchResponse.json() as { dependencyType: string; lagDays: number; notes: string | null };
    assert(patched.dependencyType === 'FF', 'Dependency type update was not persisted.');
    assert(patched.lagDays === -1, 'Dependency lead was not persisted.');
    assert(patched.notes === 'CI lead validation', 'Dependency notes were not persisted.');

    const listResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/dependencies?workspaceId=${DEV_WORKSPACE_ID}`,
      headers: { 'x-correlation-id': 'ci-dep-list' },
    });
    assert(
      listResponse.statusCode === 200,
      `Dependency list returned ${listResponse.statusCode}: ${listResponse.body}`,
    );
    const list = listResponse.json() as { items: Array<{ id: string }> };
    assert(createdIds.every((id) => list.items.some((item) => item.id === id)), 'Created dependencies are missing from list endpoint.');

    for (const id of [...createdIds].reverse()) {
      const deleteResponse = await app.inject({
        method: 'DELETE',
        url: `/api/v1/dependencies/${id}`,
        headers: { 'x-correlation-id': `ci-dep-delete-${id.slice(-4)}` },
      });
      assert(
        deleteResponse.statusCode === 204,
        `Dependency delete returned ${deleteResponse.statusCode}: ${deleteResponse.body}`,
      );
    }
    createdIds.length = 0;

    console.info(
      JSON.stringify({
        dependencyGraph: 'PASS',
        create: true,
        update: true,
        list: true,
        duplicateRejected: true,
        cycleRejected: true,
        delete: true,
      }),
    );
  } finally {
    for (const id of createdIds) {
      await app.inject({ method: 'DELETE', url: `/api/v1/dependencies/${id}` });
    }
    await app.close();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
