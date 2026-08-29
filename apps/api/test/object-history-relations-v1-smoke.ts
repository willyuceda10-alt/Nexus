import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';

const DEV_WORKSPACE_ID = '00000000-0000-4000-8000-000000000003';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const app = await buildApp();
  const createdObjectIds: string[] = [];

  try {
    const bootstrapResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'x-correlation-id': 'ci-history-relations-bootstrap' },
    });
    assert(bootstrapResponse.statusCode === 200, `Bootstrap failed: ${bootstrapResponse.body}`);
    const bootstrap = bootstrapResponse.json() as { objectDefinitions?: Array<{ id: string; key: string }> };
    const taskDefinition = bootstrap.objectDefinitions?.find((item) => item.key === 'TASK');
    assert(taskDefinition, 'TASK definition is required.');

    async function createTask(title: string) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/objects',
        headers: { 'x-correlation-id': `ci-history-relations-create-${createdObjectIds.length + 1}` },
        payload: {
          workspaceId: DEV_WORKSPACE_ID,
          objectDefinitionId: taskDefinition.id,
          objectTypeKey: 'TASK',
          title,
          description: 'Temporary Object History + Relations V1 smoke object.',
          status: 'DRAFT',
          priority: 'MEDIUM',
          progress: 0,
        },
      });
      assert(response.statusCode === 201, `Create object failed: ${response.body}`);
      const object = response.json() as { id: string; version: number; title: string };
      createdObjectIds.push(object.id);
      return object;
    }

    const source = await createTask('History/relations smoke source');
    const target = await createTask('History/relations smoke target');

    const createRelationResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/object-relations-v1',
      headers: { 'x-correlation-id': 'ci-history-relations-create-relation' },
      payload: {
        sourceObjectId: source.id,
        targetObjectId: target.id,
        relationType: 'RELATES_TO',
        notes: 'Persistent generic relation smoke.',
      },
    });
    assert(createRelationResponse.statusCode === 201, `Create relation failed: ${createRelationResponse.body}`);
    const relation = createRelationResponse.json() as { id: string; relationType: string };
    assert(relation.relationType === 'RELATES_TO', 'Unexpected relation type.');

    const duplicateResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/object-relations-v1',
      headers: { 'x-correlation-id': 'ci-history-relations-duplicate' },
      payload: {
        sourceObjectId: source.id,
        targetObjectId: target.id,
        relationType: 'RELATES_TO',
      },
    });
    assert(duplicateResponse.statusCode === 409, `Duplicate relation must return 409: ${duplicateResponse.body}`);

    const governedDependencyResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/object-relations-v1',
      headers: { 'x-correlation-id': 'ci-history-relations-governed-dependency' },
      payload: {
        sourceObjectId: source.id,
        targetObjectId: target.id,
        relationType: 'DEPENDS_ON',
      },
    });
    assert(
      governedDependencyResponse.statusCode === 400,
      `Generic relation endpoint must reject DEPENDS_ON: ${governedDependencyResponse.body}`,
    );

    const listResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/object-relations-v1?workspaceId=${DEV_WORKSPACE_ID}`,
      headers: { 'x-correlation-id': 'ci-history-relations-list' },
    });
    assert(listResponse.statusCode === 200, `List relations failed: ${listResponse.body}`);
    const list = listResponse.json() as { items: Array<{ id: string }> };
    assert(list.items.some((item) => item.id === relation.id), 'Created relation is not persisted in list endpoint.');

    const updateResponse = await app.inject({
      method: 'PATCH',
      url: `/api/v1/objects/${source.id}`,
      headers: {
        'x-correlation-id': 'ci-history-relations-update-object',
        'user-agent': 'bridata-history-relations-smoke',
      },
      payload: {
        version: source.version,
        title: 'History/relations smoke source updated',
        status: 'IN_PROGRESS',
        progress: 35,
      },
    });
    assert(updateResponse.statusCode === 200, `Update object failed: ${updateResponse.body}`);

    const collaborationResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/objects/${source.id}/collaboration-v1?commentLimit=10&auditLimit=50&historyLimit=50`,
      headers: { 'x-correlation-id': 'ci-history-relations-collaboration' },
    });
    assert(collaborationResponse.statusCode === 200, `Collaboration read failed: ${collaborationResponse.body}`);
    const collaboration = collaborationResponse.json() as {
      history: Array<{ fieldKey: string; oldValue: unknown; newValue: unknown; actor: { id: string } | null }>;
      audit: Array<{ action: string }>;
    };
    const historyFields = new Set(collaboration.history.map((entry) => entry.fieldKey));
    assert(historyFields.has('title'), 'ObjectHistory is missing title change.');
    assert(historyFields.has('status'), 'ObjectHistory is missing status change.');
    assert(historyFields.has('progress'), 'ObjectHistory is missing progress change.');
    assert(collaboration.history.every((entry) => entry.actor), 'ObjectHistory actor resolution failed.');
    assert(
      collaboration.audit.some((entry) => entry.action === 'OBJECT_RELATION_CREATED'),
      'Object relation creation is missing from object audit.',
    );

    const deleteRelationResponse = await app.inject({
      method: 'DELETE',
      url: `/api/v1/object-relations-v1/${relation.id}`,
      headers: { 'x-correlation-id': 'ci-history-relations-delete-relation' },
    });
    assert(deleteRelationResponse.statusCode === 204, `Delete relation failed: ${deleteRelationResponse.body}`);

    const listAfterDeleteResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/object-relations-v1?workspaceId=${DEV_WORKSPACE_ID}`,
      headers: { 'x-correlation-id': 'ci-history-relations-list-after-delete' },
    });
    assert(listAfterDeleteResponse.statusCode === 200, 'List after relation delete failed.');
    const listAfterDelete = listAfterDeleteResponse.json() as { items: Array<{ id: string }> };
    assert(!listAfterDelete.items.some((item) => item.id === relation.id), 'Deleted relation remains visible.');

    console.info(JSON.stringify({
      objectHistoryRelationsV1: 'PASS',
      fieldHistory: true,
      actorResolution: true,
      persistentRelations: true,
      duplicateProtection: true,
      dependencyGovernancePreserved: true,
      relationAudit: true,
    }));
  } finally {
    for (const id of createdObjectIds) {
      await app.inject({
        method: 'DELETE',
        url: `/api/v1/objects/${id}`,
        headers: { 'x-correlation-id': `ci-history-relations-cleanup-${id}` },
      });
    }
    await app.close();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
