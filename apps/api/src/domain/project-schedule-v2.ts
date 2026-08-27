import { durationUnits, type ScheduleCalendarConfig } from './work-calendar.js';

export type SchedulingMode = 'AUTO' | 'MANUAL';

export type ScheduleConstraintType =
  | 'AS_SOON_AS_POSSIBLE'
  | 'AS_LATE_AS_POSSIBLE'
  | 'MUST_START_ON'
  | 'MUST_FINISH_ON'
  | 'START_NO_EARLIER_THAN'
  | 'START_NO_LATER_THAN'
  | 'FINISH_NO_EARLIER_THAN'
  | 'FINISH_NO_LATER_THAN';

export type ScheduleProgressMethod = 'DURATION' | 'PHYSICAL';

export type ScheduleDependencyType = 'FS' | 'SS' | 'FF' | 'SF';

export interface ProjectScheduleProfileV2 {
  projectObjectId: string;
  calendarId?: string;
  schedulingMode: SchedulingMode;
  progressMethod: ScheduleProgressMethod;
  timezone: string;
  minutesPerDay: number;
  minutesPerWeek: number;
  statusDate?: Date;
  plannedStart?: Date;
  targetFinish?: Date;
}

export interface WorkItemScheduleV2 {
  objectId: string;
  projectObjectId: string;
  parentWorkItemId?: string;
  wbsCode?: string;
  outlineLevel: number;
  sortOrder: number;
  schedulingMode: SchedulingMode;
  durationMinutes: number;
  remainingDurationMinutes: number;
  constraintType: ScheduleConstraintType;
  constraintDate?: Date;
  actualStart?: Date;
  actualFinish?: Date;
  physicalPercentComplete?: number;
}

export interface ScheduleDependencyV2 {
  id?: string;
  projectObjectId: string;
  predecessorObjectId: string;
  successorObjectId: string;
  dependencyType: ScheduleDependencyType;
  lagMinutes: number;
}

export interface LegacyScheduleFields {
  startDate?: Date | null;
  dueDate?: Date | null;
  objectTypeKey: string;
}

export class ProjectScheduleV2ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectScheduleV2ValidationError';
  }
}

function requireFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new ProjectScheduleV2ValidationError(`${field} must be a finite non-negative number.`);
  }
}

function requireFinitePositive(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ProjectScheduleV2ValidationError(`${field} must be a finite positive number.`);
  }
}

export function validateProjectScheduleProfileV2(
  profile: ProjectScheduleProfileV2,
): ProjectScheduleProfileV2 {
  requireFinitePositive(profile.minutesPerDay, 'minutesPerDay');
  requireFinitePositive(profile.minutesPerWeek, 'minutesPerWeek');

  if (profile.minutesPerWeek < profile.minutesPerDay) {
    throw new ProjectScheduleV2ValidationError(
      'minutesPerWeek cannot be smaller than minutesPerDay.',
    );
  }

  if (!profile.timezone.trim()) {
    throw new ProjectScheduleV2ValidationError('timezone is required.');
  }

  if (
    profile.plannedStart &&
    profile.targetFinish &&
    profile.targetFinish.getTime() < profile.plannedStart.getTime()
  ) {
    throw new ProjectScheduleV2ValidationError(
      'targetFinish cannot be earlier than plannedStart.',
    );
  }

  return profile;
}

export function validateWorkItemScheduleV2(
  schedule: WorkItemScheduleV2,
): WorkItemScheduleV2 {
  requireFiniteNonNegative(schedule.durationMinutes, 'durationMinutes');
  requireFiniteNonNegative(schedule.remainingDurationMinutes, 'remainingDurationMinutes');

  if (!Number.isInteger(schedule.outlineLevel) || schedule.outlineLevel < 0) {
    throw new ProjectScheduleV2ValidationError(
      'outlineLevel must be a non-negative integer.',
    );
  }

  if (!Number.isInteger(schedule.sortOrder) || schedule.sortOrder < 0) {
    throw new ProjectScheduleV2ValidationError('sortOrder must be a non-negative integer.');
  }

  if (schedule.remainingDurationMinutes > schedule.durationMinutes) {
    throw new ProjectScheduleV2ValidationError(
      'remainingDurationMinutes cannot exceed durationMinutes.',
    );
  }

  const constraintNeedsDate = ![
    'AS_SOON_AS_POSSIBLE',
    'AS_LATE_AS_POSSIBLE',
  ].includes(schedule.constraintType);

  if (constraintNeedsDate && !schedule.constraintDate) {
    throw new ProjectScheduleV2ValidationError(
      `${schedule.constraintType} requires constraintDate.`,
    );
  }

  if (
    schedule.physicalPercentComplete !== undefined &&
    (!Number.isFinite(schedule.physicalPercentComplete) ||
      schedule.physicalPercentComplete < 0 ||
      schedule.physicalPercentComplete > 100)
  ) {
    throw new ProjectScheduleV2ValidationError(
      'physicalPercentComplete must be between 0 and 100.',
    );
  }

  if (
    schedule.actualStart &&
    schedule.actualFinish &&
    schedule.actualFinish.getTime() < schedule.actualStart.getTime()
  ) {
    throw new ProjectScheduleV2ValidationError(
      'actualFinish cannot be earlier than actualStart.',
    );
  }

  return schedule;
}

export function validateScheduleDependencyV2(
  dependency: ScheduleDependencyV2,
): ScheduleDependencyV2 {
  if (dependency.predecessorObjectId === dependency.successorObjectId) {
    throw new ProjectScheduleV2ValidationError(
      'A work item cannot depend on itself.',
    );
  }

  if (!Number.isFinite(dependency.lagMinutes)) {
    throw new ProjectScheduleV2ValidationError('lagMinutes must be finite.');
  }

  return dependency;
}

/**
 * Compatibility bridge for the existing Project Engine V1.
 *
 * V1 stores start/due dates directly on NexusObject. V2 stores an explicit
 * duration in minutes. Until the write APIs are migrated, this helper gives V2
 * a deterministic duration without breaking existing projects.
 */
export function durationMinutesFromLegacyFields(
  legacy: LegacyScheduleFields,
  calendar: ScheduleCalendarConfig,
  minutesPerDay = 480,
): number | null {
  requireFinitePositive(minutesPerDay, 'minutesPerDay');

  if (!legacy.startDate && !legacy.dueDate) return null;
  if (legacy.objectTypeKey === 'MILESTONE') return 0;

  const start = legacy.startDate ?? legacy.dueDate!;
  const finish = legacy.dueDate ?? start;
  const units = durationUnits(start, finish, calendar);
  return units * minutesPerDay;
}

/**
 * Validates the WBS parent graph independently from scheduling dependencies.
 * WBS is a hierarchy and must never contain a parent cycle.
 */
export function validateWbsHierarchy(
  schedules: Array<Pick<WorkItemScheduleV2, 'objectId' | 'projectObjectId' | 'parentWorkItemId'>>,
): void {
  const byId = new Map(schedules.map((item) => [item.objectId, item]));

  for (const item of schedules) {
    if (!item.parentWorkItemId) continue;

    const parent = byId.get(item.parentWorkItemId);
    if (!parent) {
      throw new ProjectScheduleV2ValidationError(
        `WBS parent ${item.parentWorkItemId} does not exist for ${item.objectId}.`,
      );
    }
    if (parent.projectObjectId !== item.projectObjectId) {
      throw new ProjectScheduleV2ValidationError(
        `WBS parent ${item.parentWorkItemId} belongs to another project.`,
      );
    }
  }

  for (const item of schedules) {
    const visited = new Set<string>();
    let cursor: typeof item | undefined = item;

    while (cursor?.parentWorkItemId) {
      if (visited.has(cursor.objectId)) {
        throw new ProjectScheduleV2ValidationError(
          `WBS hierarchy contains a cycle involving ${cursor.objectId}.`,
        );
      }
      visited.add(cursor.objectId);
      cursor = byId.get(cursor.parentWorkItemId);
    }
  }
}
