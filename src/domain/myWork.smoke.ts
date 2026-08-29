import assert from 'node:assert/strict';
import { buildMyWorkProjection } from './myWork';
import type { NexusObject, ObjectRelation } from '../types/nexus';

const base = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  description: '',
  ownerName: 'Owner',
  ownerAvatar: '',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  progress: 0,
} as const;

const objects: NexusObject[] = [
  {
    ...base,
    id: 'project-1',
    type: 'PROJECT',
    title: 'Proyecto liderado',
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    ownerId: 'user-1',
  },
  {
    ...base,
    id: 'task-overdue',
    projectId: 'project-1',
    type: 'TASK',
    title: 'Tarea vencida',
    status: 'IN_PROGRESS',
    priority: 'CRITICAL',
    ownerId: 'user-2',
    assigneeId: 'user-1',
    assigneeName: 'Usuario',
    endDate: '2026-08-25',
    effortHours: 8,
  },
  {
    ...base,
    id: 'task-today',
    projectId: 'project-1',
    type: 'TASK',
    title: 'Tarea de hoy',
    status: 'PLANNING',
    priority: 'HIGH',
    ownerId: 'user-1',
    endDate: '2026-08-26',
  },
  {
    ...base,
    id: 'task-next',
    projectId: 'project-1',
    type: 'DELIVERABLE',
    title: 'Entregable próximo',
    status: 'IN_PROGRESS',
    priority: 'MEDIUM',
    ownerId: 'user-2',
    assigneeId: 'user-1',
    assigneeName: 'Usuario',
    endDate: '2026-08-30',
    effortHours: 12,
  },
  {
    ...base,
    id: 'task-other-user',
    projectId: 'project-1',
    type: 'TASK',
    title: 'Trabajo de otra persona',
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    ownerId: 'user-1',
    assigneeId: 'user-2',
    assigneeName: 'Otra persona',
    endDate: '2026-08-26',
  },
  {
    ...base,
    id: 'predecessor-open',
    projectId: 'project-1',
    type: 'TASK',
    title: 'Predecesora abierta',
    status: 'IN_PROGRESS',
    priority: 'MEDIUM',
    ownerId: 'user-2',
    assigneeId: 'user-2',
    assigneeName: 'Otra persona',
    endDate: '2026-08-27',
  },
  {
    ...base,
    id: 'task-completed',
    projectId: 'project-1',
    type: 'TASK',
    title: 'Completada',
    status: 'COMPLETED',
    priority: 'HIGH',
    ownerId: 'user-1',
    assigneeId: 'user-1',
    assigneeName: 'Usuario',
    endDate: '2026-08-20',
  },
  {
    ...base,
    id: 'resource-1',
    type: 'RESOURCE',
    title: 'Perfil usuario',
    status: 'IN_PROGRESS',
    priority: 'MEDIUM',
    ownerId: 'user-1',
    linkedUserId: 'user-1',
    capacityHoursPerDay: 8,
  },
];

const dependencies: ObjectRelation[] = [
  {
    id: 'dep-1',
    sourceObjectId: 'task-next',
    targetObjectId: 'predecessor-open',
    relationType: 'DEPENDS_ON',
    dependencyType: 'FS',
    lagDays: 0,
  },
];

const projection = buildMyWorkProjection(objects, dependencies, 'user-1', '2026-08-26');

assert.equal(projection.summary.total, 3, 'Only assigned work and unassigned owned work should appear.');
assert.equal(projection.summary.overdue, 1);
assert.equal(projection.summary.today, 1);
assert.equal(projection.summary.next7Days, 1);
assert.equal(projection.summary.blocked, 1);
assert.equal(projection.summary.unsized, 1);
assert.equal(projection.summary.effortDueSoonHours, 12);
assert.equal(projection.summary.capacityHoursPerDay, 8);
assert.equal(projection.ownedProjects.length, 1);
assert.equal(projection.buckets.OVERDUE[0]?.objectId, 'task-overdue');
assert.equal(projection.buckets.TODAY[0]?.objectId, 'task-today');
assert.equal(projection.buckets.NEXT_7_DAYS[0]?.objectId, 'task-next');
assert.deepEqual(projection.buckets.NEXT_7_DAYS[0]?.blockerIds, ['predecessor-open']);
assert.ok(!projection.items.some((item) => item.objectId === 'task-other-user'));
assert.ok(!projection.items.some((item) => item.objectId === 'task-completed'));

console.log(
  JSON.stringify({
    myWorkSmoke: 'PASS',
    total: projection.summary.total,
    overdue: projection.summary.overdue,
    today: projection.summary.today,
    next7Days: projection.summary.next7Days,
    blocked: projection.summary.blocked,
  }),
);
