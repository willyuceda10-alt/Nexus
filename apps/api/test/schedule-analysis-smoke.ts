import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';

const PROJECT_ID = '00000000-0000-4000-8000-000000000101';
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
    for (const [predecessorId, successorId] of [[TASK_A, TASK_B], [TASK_B, TASK_C]] as const) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/dependencies',
        headers: { 'x-correlation-id': `ci-schedule-dep-${successorId.slice(-3)}` },
        payload: { predecessorId, successorId, dependencyType: 'FS', lagDays: 0 },
      });
      assert(response.statusCode === 201, `Dependency setup failed: ${response.statusCode} ${response.body}`);
      createdIds.push((response.json() as { id: string }).id);
    }

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/schedule-analysis?projectId=${PROJECT_ID}`,
      headers: { 'x-correlation-id': 'ci-schedule-analysis' },
    });
    assert(response.statusCode === 200, `Schedule analysis returned ${response.statusCode}: ${response.body}`);

    const analysis = response.json() as {
      projectId: string;
      calendar: string;
      projectDurationDays: number;
      criticalTaskIds: string[];
      topologicalOrder: string[];
      tasks: Array<{ id: string; durationDays: number; totalFloat: number; critical: boolean }>;
      dependencies: Array<{ predecessorId: string; successorId: string; type: string }>;
      unscheduledObjectIds: string[];
    };

    assert(analysis.projectId === PROJECT_ID, 'Schedule analysis project id mismatch.');
    assert(analysis.calendar === 'CALENDAR_DAYS_V1', 'Unexpected scheduling calendar contract.');
    assert(analysis.projectDurationDays === 31, `Expected 31 calendar days, got ${analysis.projectDurationDays}.`);
    assert(analysis.dependencies.length === 2, 'Schedule analysis did not include both dependencies.');
    assert(analysis.topologicalOrder.join(',') === [TASK_A, TASK_B, TASK_C].join(','), 'Unexpected topological order.');
    assert([TASK_A, TASK_B, TASK_C].every((id) => analysis.criticalTaskIds.includes(id)), 'Expected all chain tasks to be critical.');
    assert(analysis.tasks.every((task) => task.totalFloat === 0 && task.critical), 'Critical chain contains unexpected float.');
    assert(analysis.unscheduledObjectIds.length === 0, 'Seeded project unexpectedly has unscheduled objects.');

    console.info(JSON.stringify({
      scheduleAnalysis: 'PASS',
      projectDurationDays: analysis.projectDurationDays,
      criticalTasks: analysis.criticalTaskIds.length,
      dependencies: analysis.dependencies.length,
    }));
  } finally {
    for (const id of [...createdIds].reverse()) {
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
