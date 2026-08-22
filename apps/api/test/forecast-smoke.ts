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
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/forecast?projectId=${PROJECT_ID}&asOf=2026-08-21`,
      headers: { 'x-correlation-id': 'ci-forecast-smoke' },
    });
    assert(response.statusCode === 200, `Forecast returned ${response.statusCode}: ${response.body}`);

    const forecast = response.json() as {
      method: string;
      asOfDate: string;
      calendar: string;
      plannedFinish: string | null;
      forecastFinish: string | null;
      forecastVarianceDays: number | null;
      projectedTaskCount: number;
      tasks: Array<{
        id: string;
        basis: string;
        confidence: string;
        forecastFinish: string | null;
        forecastVarianceDays: number | null;
        elapsedUnits: number | null;
        remainingUnits: number | null;
      }>;
    };

    assert(forecast.method === 'PROGRESS_VELOCITY_V1', 'Unexpected forecast method.');
    assert(forecast.asOfDate === '2026-08-21', 'Forecast cutoff date mismatch.');
    assert(forecast.calendar === 'CALENDAR_DAYS_V1', `Seed should restore calendar mode, got ${forecast.calendar}.`);
    assert(forecast.plannedFinish === '2026-09-12', `Unexpected project planned finish ${forecast.plannedFinish}.`);
    assert(forecast.forecastFinish === '2026-09-12', `Unexpected project forecast finish ${forecast.forecastFinish}.`);
    assert(forecast.forecastVarianceDays === 0, 'Future planned task should keep current project finish in V1 fixture.');
    assert(forecast.projectedTaskCount === 1, `Expected one measurable active task, got ${forecast.projectedTaskCount}.`);

    const taskA = forecast.tasks.find((task) => task.id === TASK_A);
    const taskB = forecast.tasks.find((task) => task.id === TASK_B);
    const taskC = forecast.tasks.find((task) => task.id === TASK_C);
    assert(taskA && taskB && taskC, 'Forecast response is missing seeded tasks.');

    assert(taskA.basis === 'PROGRESS_VELOCITY', `TASK_A basis ${taskA.basis}.`);
    assert(taskA.forecastFinish === '2026-08-23', `TASK_A forecast ${taskA.forecastFinish}.`);
    assert(taskA.forecastVarianceDays === -1, `TASK_A variance ${taskA.forecastVarianceDays}.`);
    assert(taskA.elapsedUnits === 4, `TASK_A elapsed units ${taskA.elapsedUnits}.`);
    assert(taskA.remainingUnits === 2, `TASK_A remaining units ${taskA.remainingUnits}.`);
    assert(taskA.confidence === 'LOW', 'Four observed calendar days should be low-confidence in V1.');

    assert(taskB.basis === 'NOT_STARTED_PLAN', `TASK_B basis ${taskB.basis}.`);
    assert(taskB.forecastFinish === '2026-09-05', `TASK_B forecast ${taskB.forecastFinish}.`);
    assert(taskC.basis === 'NOT_STARTED_PLAN', `TASK_C basis ${taskC.basis}.`);
    assert(taskC.forecastFinish === '2026-09-12', `TASK_C forecast ${taskC.forecastFinish}.`);

    console.info(JSON.stringify({
      forecast: 'PASS',
      method: forecast.method,
      asOfDate: forecast.asOfDate,
      taskAProjectedFinish: taskA.forecastFinish,
      taskAPlanVarianceDays: taskA.forecastVarianceDays,
      projectForecastFinish: forecast.forecastFinish,
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
