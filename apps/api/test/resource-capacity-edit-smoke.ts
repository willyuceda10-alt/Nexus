import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000003';
const RESOURCE_ID = '00000000-0000-4000-8000-000000000080';
const TASK_ID = '00000000-0000-4000-8000-000000000102';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

async function main() {
  const app = await buildApp();

  try {
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/objects?workspaceId=${WORKSPACE_ID}&limit=100`,
      headers: { 'x-correlation-id': 'ci-resource-edit-list' },
    });
    assert(list.statusCode === 200, `Object list failed: ${list.statusCode} ${list.body}`);

    const payload = list.json() as {
      items: Array<{ id: string; version: number; metadata: unknown }>;
    };
    const resource = payload.items.find((item) => item.id === RESOURCE_ID);
    const task = payload.items.find((item) => item.id === TASK_ID);
    assert(resource && task, 'Seeded resource/task missing for edit smoke.');

    const originalResourceMetadata = asRecord(resource.metadata);
    const originalTaskMetadata = asRecord(task.metadata);

    const resourceUpdate = await app.inject({
      method: 'PATCH',
      url: `/api/v1/objects/${RESOURCE_ID}`,
      headers: { 'x-correlation-id': 'ci-resource-edit-capacity' },
      payload: {
        version: resource.version,
        metadata: {
          ...originalResourceMetadata,
          capacityHoursPerDay: 6,
          resourceWorkingWeekdays: [1, 2, 3, 4, 5],
        },
      },
    });
    assert(resourceUpdate.statusCode === 200, `Resource update failed: ${resourceUpdate.statusCode} ${resourceUpdate.body}`);
    const updatedResource = resourceUpdate.json() as { version: number };

    const taskUpdate = await app.inject({
      method: 'PATCH',
      url: `/api/v1/objects/${TASK_ID}`,
      headers: { 'x-correlation-id': 'ci-resource-edit-effort' },
      payload: {
        version: task.version,
        metadata: {
          ...originalTaskMetadata,
          effortHours: 80,
        },
      },
    });
    assert(taskUpdate.statusCode === 200, `Task effort update failed: ${taskUpdate.statusCode} ${taskUpdate.body}`);
    const updatedTask = taskUpdate.json() as { version: number };

    const analysis = await app.inject({
      method: 'GET',
      url: `/api/v1/resource-capacity?workspaceId=${WORKSPACE_ID}&from=2026-08-17&to=2026-09-12`,
      headers: { 'x-correlation-id': 'ci-resource-edit-analysis' },
    });
    assert(analysis.statusCode === 200, `Capacity analysis failed: ${analysis.statusCode} ${analysis.body}`);
    const capacity = analysis.json() as {
      resources: Array<{
        resourceId: string;
        capacityHoursPerDay: number;
        assignments: Array<{ objectId: string; effortHours?: number }>;
      }>;
    };
    const editedResource = capacity.resources.find((item) => item.resourceId === RESOURCE_ID);
    assert(editedResource, 'Edited resource missing from capacity result.');
    assert(editedResource.capacityHoursPerDay === 6, `Expected 6h/day, got ${editedResource.capacityHoursPerDay}.`);
    const editedTask = editedResource.assignments.find((item) => item.objectId === TASK_ID);
    assert(editedTask?.effortHours === 80, `Expected 80h task effort, got ${editedTask?.effortHours}.`);

    const restoreTask = await app.inject({
      method: 'PATCH',
      url: `/api/v1/objects/${TASK_ID}`,
      payload: { version: updatedTask.version, metadata: originalTaskMetadata },
    });
    assert(restoreTask.statusCode === 200, `Task restore failed: ${restoreTask.statusCode} ${restoreTask.body}`);

    const restoreResource = await app.inject({
      method: 'PATCH',
      url: `/api/v1/objects/${RESOURCE_ID}`,
      payload: { version: updatedResource.version, metadata: originalResourceMetadata },
    });
    assert(restoreResource.statusCode === 200, `Resource restore failed: ${restoreResource.statusCode} ${restoreResource.body}`);

    console.info(JSON.stringify({
      resourceCapacityEdit: 'PASS',
      capacityHoursPerDay: editedResource.capacityHoursPerDay,
      taskEffortHours: editedTask.effortHours,
      restored: true,
    }));
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
