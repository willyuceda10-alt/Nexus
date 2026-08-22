import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';

const DEV_PROJECT_ID = '00000000-0000-4000-8000-000000000101';
const DEV_WORKSPACE_ID = '00000000-0000-4000-8000-000000000003';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const app = await buildApp();

  try {
    const bootstrapResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'x-correlation-id': 'ci-objects-bootstrap' },
    });
    assert(
      bootstrapResponse.statusCode === 200,
      `Bootstrap returned ${bootstrapResponse.statusCode}: ${bootstrapResponse.body}`,
    );

    const bootstrap = bootstrapResponse.json() as {
      objectDefinitions?: Array<{ id: string; key: string }>;
    };
    const taskDefinition = bootstrap.objectDefinitions?.find((item) => item.key === 'TASK');
    assert(taskDefinition, 'TASK definition is required for CRUD smoke.');

    const seededListResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/objects?workspaceId=${DEV_WORKSPACE_ID}&limit=100`,
      headers: { 'x-correlation-id': 'ci-objects-list-seeded' },
    });
    assert(
      seededListResponse.statusCode === 200,
      `Seeded list returned ${seededListResponse.statusCode}: ${seededListResponse.body}`,
    );

    const seededList = seededListResponse.json() as {
      items: Array<{ id: string; objectTypeKey: string }>;
    };
    assert(
      seededList.items.some((item) => item.id === DEV_PROJECT_ID && item.objectTypeKey === 'PROJECT'),
      'Seeded DEV project is missing from object list.',
    );

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/objects',
      headers: { 'x-correlation-id': 'ci-objects-create' },
      payload: {
        workspaceId: DEV_WORKSPACE_ID,
        objectDefinitionId: taskDefinition.id,
        objectTypeKey: 'TASK',
        title: 'CI CRUD smoke task',
        description: 'Temporary task created by Bridata Project CI.',
        status: 'DRAFT',
        priority: 'MEDIUM',
        progress: 0,
        metadata: { projectId: DEV_PROJECT_ID, ciSmoke: true },
      },
    });
    assert(
      createResponse.statusCode === 201,
      `Create returned ${createResponse.statusCode}: ${createResponse.body}`,
    );

    const created = createResponse.json() as {
      id: string;
      version: number;
      title: string;
      status: string;
    };
    assert(created.id, 'Created object does not contain id.');
    assert(created.version === 1, `Expected initial version 1, got ${created.version}.`);

    const updateResponse = await app.inject({
      method: 'PATCH',
      url: `/api/v1/objects/${created.id}`,
      headers: { 'x-correlation-id': 'ci-objects-update' },
      payload: {
        version: created.version,
        status: 'IN_PROGRESS',
        progress: 25,
        title: 'CI CRUD smoke task updated',
      },
    });
    assert(
      updateResponse.statusCode === 200,
      `Update returned ${updateResponse.statusCode}: ${updateResponse.body}`,
    );

    const updated = updateResponse.json() as {
      id: string;
      version: number;
      status: string;
      progress: number;
      title: string;
    };
    assert(updated.id === created.id, 'Updated object id changed unexpectedly.');
    assert(updated.version === 2, `Expected version 2 after update, got ${updated.version}.`);
    assert(updated.status === 'IN_PROGRESS', 'Updated status was not persisted.');
    assert(updated.progress === 25, 'Updated progress was not persisted.');

    const staleUpdateResponse = await app.inject({
      method: 'PATCH',
      url: `/api/v1/objects/${created.id}`,
      headers: { 'x-correlation-id': 'ci-objects-stale-update' },
      payload: {
        version: created.version,
        progress: 99,
      },
    });
    assert(
      staleUpdateResponse.statusCode === 409,
      `Stale update should return 409, got ${staleUpdateResponse.statusCode}: ${staleUpdateResponse.body}`,
    );

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/v1/objects/${created.id}`,
      headers: { 'x-correlation-id': 'ci-objects-delete' },
    });
    assert(
      deleteResponse.statusCode === 204,
      `Delete returned ${deleteResponse.statusCode}: ${deleteResponse.body}`,
    );

    const afterDeleteResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/objects?workspaceId=${DEV_WORKSPACE_ID}&limit=100`,
      headers: { 'x-correlation-id': 'ci-objects-list-after-delete' },
    });
    assert(afterDeleteResponse.statusCode === 200, 'List after delete failed.');
    const afterDelete = afterDeleteResponse.json() as { items: Array<{ id: string }> };
    assert(
      !afterDelete.items.some((item) => item.id === created.id),
      'Soft-deleted object is still visible in standard list endpoint.',
    );

    console.info(
      JSON.stringify({
        objectCrud: 'PASS',
        seededProjectVisible: true,
        create: true,
        optimisticLocking: true,
        staleVersionRejected: true,
        softDeleteHidden: true,
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
