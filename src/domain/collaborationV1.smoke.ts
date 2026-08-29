import { mapObjectCollaborationV1 } from './collaborationV1';
import type { ApiObjectCollaborationV1 } from '../api/collaborationV1Contracts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const payload: ApiObjectCollaborationV1 = {
  objectId: '00000000-0000-4000-8000-000000000111',
  comments: [
    {
      id: '00000000-0000-4000-8000-000000000201',
      objectId: '00000000-0000-4000-8000-000000000111',
      userId: '00000000-0000-4000-8000-000000000001',
      content: 'Comentario persistente',
      metadata: null,
      createdAt: '2026-08-29T17:00:00.000Z',
      updatedAt: '2026-08-29T17:00:00.000Z',
      author: {
        id: '00000000-0000-4000-8000-000000000001',
        fullName: 'Usuario DEV',
        email: 'dev@example.com',
        avatarUrl: null,
      },
    },
  ],
  history: [
    {
      id: '00000000-0000-4000-8000-000000000301',
      objectId: '00000000-0000-4000-8000-000000000111',
      userId: '00000000-0000-4000-8000-000000000001',
      fieldKey: 'status',
      oldValue: 'DRAFT',
      newValue: 'IN_PROGRESS',
      createdAt: '2026-08-29T17:01:00.000Z',
      actor: {
        id: '00000000-0000-4000-8000-000000000001',
        fullName: 'Usuario DEV',
        email: 'dev@example.com',
        avatarUrl: null,
      },
    },
  ],
  audit: [
    {
      id: '00000000-0000-4000-8000-000000000401',
      userId: '00000000-0000-4000-8000-000000000001',
      action: 'OBJECT_COMMENT_CREATED',
      resource: 'NEXUS_OBJECT',
      resourceId: '00000000-0000-4000-8000-000000000111',
      details: { commentId: '00000000-0000-4000-8000-000000000201' },
      correlationId: 'smoke-correlation',
      createdAt: '2026-08-29T17:02:00.000Z',
      actor: {
        id: '00000000-0000-4000-8000-000000000001',
        fullName: 'Usuario DEV',
        email: 'dev@example.com',
        avatarUrl: null,
      },
    },
  ],
};

const mapped = mapObjectCollaborationV1(payload);

assert(mapped.comments.length === 1, 'Expected one mapped persistent comment.');
assert(mapped.comments[0]?.content === 'Comentario persistente', 'Comment content was not preserved.');
assert(mapped.comments[0]?.userName === 'Usuario DEV', 'Comment author was not resolved.');
assert(mapped.activityLogs.length === 2, 'Expected history plus audit activity.');
assert(mapped.activityLogs[0]?.action === 'Agregó un comentario', 'Audit action was not localized.');
assert(mapped.activityLogs[1]?.oldValue === 'DRAFT', 'History old value was not preserved.');
assert(mapped.activityLogs[1]?.newValue === 'IN_PROGRESS', 'History new value was not preserved.');

console.info(JSON.stringify({
  collaborationV1Frontend: 'PASS',
  persistentComments: true,
  persistentAudit: true,
  fieldHistoryMapping: true,
  chronologicalOrdering: true,
}));
