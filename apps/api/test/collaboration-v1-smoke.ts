import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';

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
      headers: { 'x-correlation-id': 'ci-collaboration-bootstrap' },
    });
    assert(
      bootstrapResponse.statusCode === 200,
      `Bootstrap returned ${bootstrapResponse.statusCode}: ${bootstrapResponse.body}`,
    );

    const bootstrap = bootstrapResponse.json() as {
      objectDefinitions?: Array<{ id: string; key: string }>;
    };
    const taskDefinition = bootstrap.objectDefinitions?.find((item) => item.key === 'TASK');
    assert(taskDefinition, 'TASK definition is required for collaboration smoke.');

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/objects',
      headers: { 'x-correlation-id': 'ci-collaboration-create-object' },
      payload: {
        workspaceId: DEV_WORKSPACE_ID,
        objectDefinitionId: taskDefinition.id,
        objectTypeKey: 'TASK',
        title: 'CI collaboration smoke task',
        description: 'Temporary object for persistent collaboration verification.',
        status: 'DRAFT',
        priority: 'MEDIUM',
        progress: 0,
      },
    });
    assert(
      createResponse.statusCode === 201,
      `Create returned ${createResponse.statusCode}: ${createResponse.body}`,
    );

    const created = createResponse.json() as { id: string; version: number };
    assert(created.id, 'Created collaboration object does not contain id.');

    const commentText = 'Comentario persistente de Collaboration Core V1';
    const commentResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/objects/${created.id}/comments`,
      headers: { 'x-correlation-id': 'ci-collaboration-comment' },
      payload: { content: commentText },
    });
    assert(
      commentResponse.statusCode === 201,
      `Comment returned ${commentResponse.statusCode}: ${commentResponse.body}`,
    );

    const comment = commentResponse.json() as {
      id: string;
      objectId: string;
      content: string;
      author: { id: string; fullName: string } | null;
    };
    assert(comment.id, 'Created comment does not contain id.');
    assert(comment.objectId === created.id, 'Comment objectId does not match target object.');
    assert(comment.content === commentText, 'Comment content was not persisted exactly.');
    assert(comment.author?.id, 'Comment response is missing author identity.');

    const updateResponse = await app.inject({
      method: 'PATCH',
      url: `/api/v1/objects/${created.id}`,
      headers: { 'x-correlation-id': 'ci-collaboration-update' },
      payload: {
        version: created.version,
        status: 'IN_PROGRESS',
        progress: 30,
      },
    });
    assert(
      updateResponse.statusCode === 200,
      `Update returned ${updateResponse.statusCode}: ${updateResponse.body}`,
    );

    const collaborationResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/objects/${created.id}/collaboration-v1?commentLimit=20&auditLimit=20&historyLimit=20`,
      headers: { 'x-correlation-id': 'ci-collaboration-read' },
    });
    assert(
      collaborationResponse.statusCode === 200,
      `Collaboration read returned ${collaborationResponse.statusCode}: ${collaborationResponse.body}`,
    );

    const collaboration = collaborationResponse.json() as {
      objectId: string;
      comments: Array<{ id: string; content: string; author: { id: string } | null }>;
      history: Array<{ id: string; fieldKey: string }>;
      audit: Array<{ action: string; details: unknown; actor: { id: string } | null }>;
    };

    assert(collaboration.objectId === created.id, 'Collaboration response objectId mismatch.');
    assert(
      collaboration.comments.some((item) => item.id === comment.id && item.content === commentText),
      'Persisted comment was not returned by collaboration endpoint.',
    );
    assert(
      collaboration.audit.some((entry) => entry.action === 'OBJECT_CREATED'),
      'Persistent audit is missing OBJECT_CREATED.',
    );
    assert(
      collaboration.audit.some((entry) => entry.action === 'OBJECT_COMMENT_CREATED'),
      'Persistent audit is missing OBJECT_COMMENT_CREATED.',
    );
    assert(
      collaboration.audit.some((entry) => entry.action === 'OBJECT_UPDATED'),
      'Persistent audit is missing OBJECT_UPDATED.',
    );
    assert(
      collaboration.audit.every((entry) => entry.actor?.id),
      'Expected actor identity on tenant-scoped object audit entries.',
    );

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/v1/objects/${created.id}`,
      headers: { 'x-correlation-id': 'ci-collaboration-delete' },
    });
    assert(
      deleteResponse.statusCode === 204,
      `Cleanup delete returned ${deleteResponse.statusCode}: ${deleteResponse.body}`,
    );

    console.info(
      JSON.stringify({
        collaborationV1: 'PASS',
        persistentComment: true,
        persistentObjectAudit: true,
        authorResolution: true,
        tenantRlsTablesReused: true,
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
