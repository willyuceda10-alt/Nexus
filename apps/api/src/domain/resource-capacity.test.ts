import { describe, expect, it } from 'vitest';
import { analyzeResourceCapacity } from './resource-capacity.js';

const workCalendar = {
  mode: 'WORKING_DAYS_V1' as const,
  workingWeekdays: [1, 2, 3, 4, 5],
  holidays: [],
};

describe('resource capacity', () => {
  it('distributes effort, detects daily overallocation, unsized work and unprofiled assignments', () => {
    const result = analyzeResourceCapacity(
      [{
        resourceId: 'r1',
        linkedUserId: 'u1',
        name: 'Resource One',
        capacityHoursPerDay: 8,
        workingWeekdays: [1, 2, 3, 4, 5],
        holidays: [],
      }],
      [
        {
          objectId: 'a1',
          title: 'Base workload',
          assigneeId: 'u1',
          effortHours: 40,
          startDate: new Date('2026-08-17T00:00:00.000Z'),
          dueDate: new Date('2026-08-21T00:00:00.000Z'),
          projectCalendar: workCalendar,
        },
        {
          objectId: 'a2',
          title: 'Wednesday spike',
          assigneeId: 'u1',
          effortHours: 8,
          startDate: new Date('2026-08-19T00:00:00.000Z'),
          dueDate: new Date('2026-08-19T00:00:00.000Z'),
          projectCalendar: workCalendar,
        },
        {
          objectId: 'a3',
          title: 'Unestimated task',
          assigneeId: 'u1',
          startDate: new Date('2026-08-20T00:00:00.000Z'),
          dueDate: new Date('2026-08-21T00:00:00.000Z'),
          projectCalendar: workCalendar,
        },
        {
          objectId: 'a4',
          title: 'No resource profile',
          assigneeId: 'u2',
          effortHours: 10,
          startDate: new Date('2026-08-17T00:00:00.000Z'),
          dueDate: new Date('2026-08-18T00:00:00.000Z'),
          projectCalendar: workCalendar,
        },
      ],
      {
        from: new Date('2026-08-17T00:00:00.000Z'),
        to: new Date('2026-08-21T00:00:00.000Z'),
      },
    );

    expect(result.unprofiledAssignments).toBe(1);
    expect(result.unprofiledSizedHours).toBe(10);
    expect(result.resources).toHaveLength(1);

    const resource = result.resources[0]!;
    expect(resource.capacityHours).toBe(40);
    expect(resource.allocatedHours).toBe(48);
    expect(resource.utilizationPct).toBe(120);
    expect(resource.overallocatedHours).toBe(8);
    expect(resource.unsizedItems).toBe(1);
    expect(resource.unscheduledItems).toBe(0);
    expect(resource.weeks).toEqual([
      expect.objectContaining({
        weekStart: '2026-08-17',
        capacityHours: 40,
        allocatedHours: 48,
        utilizationPct: 120,
        overallocatedHours: 8,
      }),
    ]);
  });
});
