import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';

const PROJECT_ID = '00000000-0000-4000-8000-000000000101';
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000003';
const TASK_A = '00000000-0000-4000-8000-000000000102';
const TASK_B = '00000000-0000-4000-8000-000000000103';
const TASK_C = '00000000-0000-4000-8000-000000000104';
const HOLIDAY = '2026-08-21';

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
  const dependencyIds: string[] = [];
  let originalMetadata: Record<string, unknown> | null = null;
  let calendarWasUpdated = false;

  try {
    const listResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/objects?workspaceId=${WORKSPACE_ID}&limit=100`,
      headers: { 'x-correlation-id': 'ci-working-calendar-list' },
    });
    assert(listResponse.statusCode === 200, `Object list failed: ${listResponse.body}`);

    const project = (listResponse.json() as {
      items: Array<{ id: string; version: number; metadata: unknown }>;
    }).items.find((item) => item.id === PROJECT_ID);
    assert(project, 'Seeded project was not found.');

    originalMetadata = asRecord(project.metadata);
    const workingMetadata = {
      ...originalMetadata,
      scheduleCalendarMode: 'WORKING_DAYS_V1',
      scheduleWorkingWeekdays: [1, 2, 3, 4, 5],
      scheduleHolidays: [HOLIDAY],
    };

    const calendarUpdate = await app.inject({
      method: 'PATCH',
      url: `/api/v1/objects/${PROJECT_ID}`,
      headers: { 'x-correlation-id': 'ci-working-calendar-configure' },
      payload: {
        version: project.version,
        metadata: workingMetadata,
      },
    });
    assert(
      calendarUpdate.statusCode === 200,
      `Calendar configuration failed: ${calendarUpdate.statusCode} ${calendarUpdate.body}`,
    );
    calendarWasUpdated = true;

    for (const [predecessorId, successorId] of [[TASK_A, TASK_B], [TASK_B, TASK_C]] as const) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/dependencies',
        headers: { 'x-correlation-id': `ci-working-calendar-dep-${successorId.slice(-3)}` },
        payload: { predecessorId, successorId, dependencyType: 'FS', lagDays: 0 },
      });
      assert(
        response.statusCode === 201,
        `Dependency setup failed: ${response.statusCode} ${response.body}`,
      );
      dependencyIds.push((response.json() as { id: string }).id);
    }

    const analysisResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/schedule-analysis?projectId=${PROJECT_ID}`,
      headers: { 'x-correlation-id': 'ci-working-calendar-analysis' },
    });
    assert(
      analysisResponse.statusCode === 200,
      `Working calendar analysis returned ${analysisResponse.statusCode}: ${analysisResponse.body}`,
    );

    const analysis = analysisResponse.json() as {
      calendar: string;
      workingWeekdays: number[];
      holidays: string[];
      projectDurationDays: number;
      criticalTaskIds: string[];
      tasks: Array<{ id: string; durationDays: number; totalFloat: number; critical: boolean }>;
    };

    assert(analysis.calendar === 'WORKING_DAYS_V1', `Unexpected calendar: ${analysis.calendar}.`);
    assert(analysis.workingWeekdays.join(',') === '1,2,3,4,5', 'Working weekdays were not preserved.');
    assert(analysis.holidays.includes(HOLIDAY), 'Configured holiday was not returned.');

    const durations = new Map(analysis.tasks.map((task) => [task.id, task.durationDays]));
    assert(durations.get(TASK_A) === 4, `TASK_A expected 4 working days, got ${durations.get(TASK_A)}.`);
    assert(durations.get(TASK_B) === 9, `TASK_B expected 9 working days, got ${durations.get(TASK_B)}.`);
    assert(durations.get(TASK_C) === 9, `TASK_C expected 9 working days, got ${durations.get(TASK_C)}.`);
    assert(
      analysis.projectDurationDays === 22,
      `Expected 22 working-day units for the FS chain, got ${analysis.projectDurationDays}.`,
    );
    assert(
      [TASK_A, TASK_B, TASK_C].every((id) => analysis.criticalTaskIds.includes(id)),
      'Expected all chain tasks to remain critical.',
    );
    assert(
      analysis.tasks.every((task) => task.totalFloat === 0 && task.critical),
      'Working calendar critical chain contains unexpected float.',
    );

    console.info(JSON.stringify({
      workingCalendar: 'PASS',
      calendar: analysis.calendar,
      projectDurationDays: analysis.projectDurationDays,
      durations: Object.fromEntries(durations),
      holidayExcluded: HOLIDAY,
    }));
  } finally {
    for (const id of [...dependencyIds].reverse()) {
      await app.inject({ method: 'DELETE', url: `/api/v1/dependencies/${id}` });
    }

    if (calendarWasUpdated && originalMetadata) {
      const latestList = await app.inject({
        method: 'GET',
        url: `/api/v1/objects?workspaceId=${WORKSPACE_ID}&limit=100`,
        headers: { 'x-correlation-id': 'ci-working-calendar-restore-list' },
      });
      const latestProject = (latestList.json() as {
        items: Array<{ id: string; version: number }>;
      }).items.find((item) => item.id === PROJECT_ID);

      if (latestProject) {
        await app.inject({
          method: 'PATCH',
          url: `/api/v1/objects/${PROJECT_ID}`,
          headers: { 'x-correlation-id': 'ci-working-calendar-restore' },
          payload: {
            version: latestProject.version,
            metadata: originalMetadata,
          },
        });
      }
    }

    await app.close();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
