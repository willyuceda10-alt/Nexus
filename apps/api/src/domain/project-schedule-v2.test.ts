import { describe, expect, it } from 'vitest';
import {
  ProjectScheduleV2ValidationError,
  durationMinutesFromLegacyFields,
  validateProjectScheduleProfileV2,
  validateScheduleDependencyV2,
  validateWbsHierarchy,
  validateWorkItemScheduleV2,
} from './project-schedule-v2.js';

const workingCalendar = {
  mode: 'WORKING_DAYS_V1' as const,
  workingWeekdays: [1, 2, 3, 4, 5],
  holidays: [],
};

describe('Project Engine V2 foundation', () => {
  it('derives legacy duration in minutes without changing V1 storage', () => {
    expect(durationMinutesFromLegacyFields({
      objectTypeKey: 'TASK',
      startDate: new Date('2026-08-24T00:00:00.000Z'),
      dueDate: new Date('2026-08-28T00:00:00.000Z'),
    }, workingCalendar, 480)).toBe(2400);

    expect(durationMinutesFromLegacyFields({
      objectTypeKey: 'MILESTONE',
      startDate: new Date('2026-08-28T00:00:00.000Z'),
      dueDate: new Date('2026-08-28T00:00:00.000Z'),
    }, workingCalendar, 480)).toBe(0);
  });

  it('requires explicit dates for hard and semi-flexible constraints', () => {
    expect(() => validateWorkItemScheduleV2({
      objectId: 'task-a',
      projectObjectId: 'project-a',
      outlineLevel: 1,
      sortOrder: 0,
      schedulingMode: 'AUTO',
      durationMinutes: 480,
      remainingDurationMinutes: 480,
      constraintType: 'MUST_START_ON',
    })).toThrow(ProjectScheduleV2ValidationError);
  });

  it('supports lead as negative dependency lag', () => {
    expect(validateScheduleDependencyV2({
      projectObjectId: 'project-a',
      predecessorObjectId: 'task-a',
      successorObjectId: 'task-b',
      dependencyType: 'FS',
      lagMinutes: -240,
    }).lagMinutes).toBe(-240);
  });

  it('rejects invalid project schedule capacity units', () => {
    expect(() => validateProjectScheduleProfileV2({
      projectObjectId: 'project-a',
      schedulingMode: 'AUTO',
      progressMethod: 'DURATION',
      timezone: 'America/Lima',
      minutesPerDay: 480,
      minutesPerWeek: 300,
    })).toThrow(ProjectScheduleV2ValidationError);
  });

  it('accepts a valid WBS hierarchy and rejects a cycle', () => {
    expect(() => validateWbsHierarchy([
      { objectId: 'summary', projectObjectId: 'project-a' },
      { objectId: 'task-a', projectObjectId: 'project-a', parentWorkItemId: 'summary' },
      { objectId: 'task-b', projectObjectId: 'project-a', parentWorkItemId: 'summary' },
    ])).not.toThrow();

    expect(() => validateWbsHierarchy([
      { objectId: 'task-a', projectObjectId: 'project-a', parentWorkItemId: 'task-b' },
      { objectId: 'task-b', projectObjectId: 'project-a', parentWorkItemId: 'task-a' },
    ])).toThrow(ProjectScheduleV2ValidationError);
  });
});
