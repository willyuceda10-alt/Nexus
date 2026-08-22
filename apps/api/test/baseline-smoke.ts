import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';

const PROJECT_ID = '00000000-0000-4000-8000-000000000101';
const TASK_IDS = [
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000103',
  '00000000-0000-4000-8000-000000000104',
] as const;
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000003';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function dateOnly(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

async function main() {
  const app = await buildApp();

  try {
    const conflictResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${PROJECT_ID}/baseline`,
      headers: { 'x-correlation-id': 'ci-baseline-existing' },
      payload: { overwrite: false },
    });
    assert(
      conflictResponse.statusCode === 409,
      `Existing baseline should require overwrite, got ${conflictResponse.statusCode}: ${conflictResponse.body}`,
    );

    const saveResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${PROJECT_ID}/baseline`,
      headers: { 'x-correlation-id': 'ci-baseline-overwrite' },
      payload: { overwrite: true },
    });
    assert(
      saveResponse.statusCode === 201,
      `Baseline overwrite returned ${saveResponse.statusCode}: ${saveResponse.body}`,
    );

    const summary = saveResponse.json() as {
      projectId: string;
      workspaceId: string;
      baselineVersion: number;
      capturedAt: string;
      updatedCount: number;
      scheduledCount: number;
      skippedUnscheduledCount: number;
      overwritten: boolean;
    };

    assert(summary.projectId === PROJECT_ID, 'Baseline summary project id mismatch.');
    assert(summary.workspaceId === WORKSPACE_ID, 'Baseline summary workspace id mismatch.');
    assert(summary.baselineVersion >= 1, 'Baseline version was not assigned.');
    assert(summary.updatedCount === 4, `Expected 4 snapshot objects, got ${summary.updatedCount}.`);
    assert(summary.scheduledCount === 4, `Expected 4 scheduled snapshot objects, got ${summary.scheduledCount}.`);
    assert(summary.skippedUnscheduledCount === 0, 'Seeded project should not have unscheduled baseline objects.');
    assert(summary.overwritten, 'Expected overwrite marker to be true.');
    assert(!Number.isNaN(Date.parse(summary.capturedAt)), 'Baseline capturedAt is not a valid timestamp.');

    const listResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/objects?workspaceId=${WORKSPACE_ID}&limit=100`,
      headers: { 'x-correlation-id': 'ci-baseline-list' },
    });
    assert(listResponse.statusCode === 200, `Object list failed after baseline: ${listResponse.body}`);

    const listed = listResponse.json() as {
      items: Array<{
        id: string;
        startDate: string | null;
        dueDate: string | null;
        metadata: unknown;
      }>;
    };
    const expectedIds = [PROJECT_ID, ...TASK_IDS];

    for (const id of expectedIds) {
      const object = listed.items.find((item) => item.id === id);
      assert(object, `Baseline object ${id} is missing from list.`);
      const metadata = asRecord(object.metadata);
      assert(
        metadata.baselineStartDate === dateOnly(object.startDate),
        `baselineStartDate mismatch for ${id}.`,
      );
      assert(
        metadata.baselineEndDate === dateOnly(object.dueDate),
        `baselineEndDate mismatch for ${id}.`,
      );
      assert(
        typeof metadata.baselineCapturedAt === 'string',
        `baselineCapturedAt missing for ${id}.`,
      );
    }

    const project = listed.items.find((item) => item.id === PROJECT_ID)!;
    const projectMetadata = asRecord(project.metadata);
    assert(
      typeof projectMetadata.baselineVersion === 'number' && projectMetadata.baselineVersion >= 1,
      'Project baselineVersion was not persisted.',
    );

    const reconfirmResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${PROJECT_ID}/baseline`,
      headers: { 'x-correlation-id': 'ci-baseline-reconfirm' },
      payload: { overwrite: false },
    });
    assert(
      reconfirmResponse.statusCode === 409,
      `Baseline replacement should require confirmation after save, got ${reconfirmResponse.statusCode}.`,
    );

    console.info(JSON.stringify({
      baseline: 'PASS',
      projectId: summary.projectId,
      baselineVersion: summary.baselineVersion,
      updatedCount: summary.updatedCount,
      overwriteProtected: true,
      persisted: true,
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
