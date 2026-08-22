import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000003';
const USER_ID = '00000000-0000-4000-8000-000000000001';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const app = await buildApp();
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/resource-capacity?workspaceId=${WORKSPACE_ID}&from=2026-08-17&to=2026-09-12`,
      headers: { 'x-correlation-id': 'ci-resource-capacity' },
    });

    assert(response.statusCode === 200, `Resource capacity returned ${response.statusCode}: ${response.body}`);
    const payload = response.json() as {
      method?: string;
      profileCount?: number;
      assignmentCount?: number;
      resources?: Array<{
        linkedUserId?: string;
        capacityHoursPerDay?: number;
        allocatedHours?: number;
        utilizationPct?: number;
        assignments?: Array<{ effortHours?: number; sized?: boolean }>;
      }>;
    };

    assert(payload.method === 'EFFORT_DISTRIBUTION_V1', 'Unexpected resource capacity method.');
    assert(payload.profileCount === 1, `Expected one seeded resource profile, got ${payload.profileCount}.`);
    assert(payload.assignmentCount === 3, `Expected three seeded open assignments, got ${payload.assignmentCount}.`);

    const owner = payload.resources?.find((resource) => resource.linkedUserId === USER_ID);
    assert(owner, 'Seeded resource linked to DEV owner was not returned.');
    assert(owner.capacityHoursPerDay === 8, `Expected 8h/day capacity, got ${owner.capacityHoursPerDay}.`);
    assert(owner.assignments?.length === 3, `Expected three resource assignments, got ${owner.assignments?.length}.`);
    assert(owner.assignments.every((assignment) => assignment.sized), 'All seeded resource assignments should be sized.');

    const totalEffort = owner.assignments.reduce((sum, assignment) => sum + (assignment.effortHours ?? 0), 0);
    assert(totalEffort === 160, `Expected 160 seeded effort hours, got ${totalEffort}.`);
    assert((owner.allocatedHours ?? 0) > 0, 'Resource capacity did not allocate effort into the requested range.');
    assert(typeof owner.utilizationPct === 'number', 'Resource utilization percentage is missing.');

    console.info(JSON.stringify({
      resourceCapacity: 'PASS',
      profileCount: payload.profileCount,
      assignmentCount: payload.assignmentCount,
      totalEffort,
      allocatedHours: owner.allocatedHours,
      utilizationPct: owner.utilizationPct,
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
