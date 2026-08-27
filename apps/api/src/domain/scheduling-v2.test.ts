import { describe, expect, it } from 'vitest';
import { calculateScheduleV2 } from './scheduling-v2.js';
import {
  dateAtWorkingMinuteOffsetV2,
  workingMinuteOffsetV2,
  workingMinutesOnDateV2,
  type WorkCalendarV2,
} from './work-calendar-v2.js';

const calendar: WorkCalendarV2 = {
  timezone: 'America/Lima',
  workingWeekdays: [1, 2, 3, 4, 5],
  minutesPerDay: 480,
  exceptions: [
    {
      exceptionDate: new Date('2026-08-26T00:00:00.000Z'),
      isWorking: false,
    },
    {
      exceptionDate: new Date('2026-08-29T00:00:00.000Z'),
      isWorking: true,
      workingMinutes: 240,
    },
  ],
};

describe('work calendar v2', () => {
  it('applies weekdays and exception capacity in working minutes', () => {
    expect(workingMinutesOnDateV2(new Date('2026-08-24T00:00:00.000Z'), calendar)).toBe(480);
    expect(workingMinutesOnDateV2(new Date('2026-08-26T00:00:00.000Z'), calendar)).toBe(0);
    expect(workingMinutesOnDateV2(new Date('2026-08-29T00:00:00.000Z'), calendar)).toBe(240);
  });

  it('maps offsets through non-working dates', () => {
    const anchor = new Date('2026-08-24T00:00:00.000Z');
    expect(workingMinuteOffsetV2(anchor, new Date('2026-08-27T00:00:00.000Z'), calendar)).toBe(960);
    expect(dateAtWorkingMinuteOffsetV2(anchor, 960, calendar).toISOString().slice(0, 10)).toBe('2026-08-27');
  });
});

describe('scheduling engine v2', () => {
  it('calculates CPM in working minutes with dependencies and a holiday', () => {
    const result = calculateScheduleV2({
      anchorDate: new Date('2026-08-24T00:00:00.000Z'),
      calendar,
      tasks: [
        {
          id: 'a',
          title: 'Design',
          durationMinutes: 480,
          schedulingMode: 'AUTO',
          constraintType: 'AS_SOON_AS_POSSIBLE',
        },
        {
          id: 'b',
          title: 'Build',
          durationMinutes: 960,
          schedulingMode: 'AUTO',
          constraintType: 'AS_SOON_AS_POSSIBLE',
        },
        {
          id: 'c',
          title: 'Review',
          durationMinutes: 480,
          schedulingMode: 'AUTO',
          constraintType: 'AS_SOON_AS_POSSIBLE',
        },
      ],
      dependencies: [
        { predecessorId: 'a', successorId: 'b', type: 'FS', lagMinutes: 0 },
        { predecessorId: 'b', successorId: 'c', type: 'FS', lagMinutes: 0 },
      ],
    });

    expect(result.naturalFinishMinutes).toBe(1920);
    expect(result.criticalTaskIds).toEqual(['a', 'b', 'c']);
    expect(result.tasks.find((task) => task.id === 'a')?.plannedStart).toBe('2026-08-24');
    expect(result.tasks.find((task) => task.id === 'b')?.plannedStart).toBe('2026-08-25');
    expect(result.tasks.find((task) => task.id === 'b')?.plannedFinish).toBe('2026-08-28');
    expect(result.tasks.find((task) => task.id === 'c')?.plannedStart).toBe('2026-08-31');
    expect(result.feasible).toBe(true);
  });

  it('supports SS lead/lag and detects a hard constraint conflict', () => {
    const result = calculateScheduleV2({
      anchorDate: new Date('2026-08-24T00:00:00.000Z'),
      calendar: { ...calendar, exceptions: [] },
      tasks: [
        {
          id: 'a',
          durationMinutes: 960,
          schedulingMode: 'AUTO',
          constraintType: 'AS_SOON_AS_POSSIBLE',
        },
        {
          id: 'b',
          durationMinutes: 480,
          schedulingMode: 'AUTO',
          constraintType: 'MUST_START_ON',
          constraintDate: new Date('2026-08-24T00:00:00.000Z'),
        },
      ],
      dependencies: [
        { predecessorId: 'a', successorId: 'b', type: 'SS', lagMinutes: 480 },
      ],
    });

    expect(result.tasks.find((task) => task.id === 'b')?.earlyStartMinutes).toBe(480);
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'CONSTRAINT_MISSED', taskId: 'b' }),
    ]));
    expect(result.feasible).toBe(false);
  });

  it('uses the late pass for ALAP work when a project target exists', () => {
    const result = calculateScheduleV2({
      anchorDate: new Date('2026-08-24T00:00:00.000Z'),
      targetFinish: new Date('2026-08-28T00:00:00.000Z'),
      calendar: { ...calendar, exceptions: [] },
      tasks: [
        {
          id: 'alap',
          durationMinutes: 480,
          schedulingMode: 'AUTO',
          constraintType: 'AS_LATE_AS_POSSIBLE',
        },
      ],
      dependencies: [],
    });

    const task = result.tasks[0]!;
    expect(task.scheduledStartMinutes).toBe(1920);
    expect(task.plannedStart).toBe('2026-08-28');
    expect(task.plannedFinish).toBe('2026-08-28');
  });
});
