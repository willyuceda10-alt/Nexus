import { isWorkingDate, type ScheduleCalendarConfig } from './work-calendar.js';

const DAY_MS = 86_400_000;

export interface ResourceCapacityProfile {
  resourceId: string;
  linkedUserId?: string;
  name: string;
  capacityHoursPerDay: number;
  workingWeekdays: number[];
  holidays: string[];
}

export interface ResourceCapacityAssignment {
  objectId: string;
  title: string;
  assigneeId?: string;
  projectId?: string;
  effortHours?: number;
  startDate?: Date;
  dueDate?: Date;
  projectCalendar: ScheduleCalendarConfig;
}

export interface CapacityRange {
  from: Date;
  to: Date;
}

export interface ResourceCapacityWeek {
  weekStart: string;
  capacityHours: number;
  allocatedHours: number;
  utilizationPct: number;
  overallocatedHours: number;
}

export interface ResourceCapacityResult {
  resourceId: string;
  linkedUserId?: string;
  name: string;
  capacityHoursPerDay: number;
  capacityHours: number;
  allocatedHours: number;
  utilizationPct: number;
  overallocatedHours: number;
  unsizedItems: number;
  unscheduledItems: number;
  weeks: ResourceCapacityWeek[];
  assignments: Array<{
    objectId: string;
    title: string;
    projectId?: string;
    effortHours?: number;
    allocatedHoursInRange: number;
    startDate?: string;
    dueDate?: string;
    sized: boolean;
    scheduled: boolean;
  }>;
}

export interface ResourceCapacityAnalysis {
  from: string;
  to: string;
  resources: ResourceCapacityResult[];
  unprofiledAssignments: number;
  unprofiledSizedHours: number;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(date: Date): Date {
  return new Date(`${dateOnly(date)}T00:00:00.000Z`);
}

function normalizeRange(range: CapacityRange): CapacityRange {
  const from = startOfUtcDay(range.from);
  const to = startOfUtcDay(range.to);
  return to.getTime() < from.getTime() ? { from: to, to: from } : { from, to };
}

function eachDate(from: Date, to: Date): Date[] {
  const dates: Date[] = [];
  for (
    let cursor = startOfUtcDay(from);
    cursor.getTime() <= startOfUtcDay(to).getTime();
    cursor = new Date(cursor.getTime() + DAY_MS)
  ) {
    dates.push(cursor);
  }
  return dates;
}

function weekStart(date: Date): string {
  const day = date.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  return dateOnly(new Date(date.getTime() + offset * DAY_MS));
}

function pct(allocated: number, capacity: number): number {
  if (capacity <= 0) return allocated > 0 ? 999 : 0;
  return Math.round((allocated / capacity) * 100);
}

function roundHours(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function resourceCalendar(profile: ResourceCapacityProfile): ScheduleCalendarConfig {
  return {
    mode: 'WORKING_DAYS_V1',
    workingWeekdays: profile.workingWeekdays.length > 0 ? profile.workingWeekdays : [1, 2, 3, 4, 5],
    holidays: profile.holidays,
  };
}

export function analyzeResourceCapacity(
  profiles: ResourceCapacityProfile[],
  assignments: ResourceCapacityAssignment[],
  requestedRange: CapacityRange,
): ResourceCapacityAnalysis {
  const range = normalizeRange(requestedRange);
  const rangeDates = eachDate(range.from, range.to);
  const profileByUser = new Map(
    profiles
      .filter((profile) => profile.linkedUserId)
      .map((profile) => [profile.linkedUserId!, profile]),
  );

  const allocationByResource = new Map<string, Map<string, number>>();
  const assignmentRows = new Map<string, ResourceCapacityResult['assignments']>();
  const unsizedByResource = new Map<string, number>();
  const unscheduledByResource = new Map<string, number>();
  let unprofiledAssignments = 0;
  let unprofiledSizedHours = 0;

  for (const profile of profiles) {
    allocationByResource.set(profile.resourceId, new Map());
    assignmentRows.set(profile.resourceId, []);
  }

  for (const assignment of assignments) {
    if (!assignment.assigneeId) continue;
    const profile = profileByUser.get(assignment.assigneeId);
    const effort = assignment.effortHours;
    const sized = typeof effort === 'number' && Number.isFinite(effort) && effort > 0;
    const scheduled = Boolean(assignment.startDate && assignment.dueDate);

    if (!profile) {
      unprofiledAssignments += 1;
      if (sized) unprofiledSizedHours += effort!;
      continue;
    }

    let allocatedHoursInRange = 0;
    if (!sized) {
      unsizedByResource.set(profile.resourceId, (unsizedByResource.get(profile.resourceId) ?? 0) + 1);
    } else if (!scheduled) {
      unscheduledByResource.set(profile.resourceId, (unscheduledByResource.get(profile.resourceId) ?? 0) + 1);
    } else {
      const start = startOfUtcDay(assignment.startDate!);
      const due = startOfUtcDay(assignment.dueDate!);
      const safeDue = due.getTime() < start.getTime() ? start : due;
      const workDates = eachDate(start, safeDue).filter((date) => isWorkingDate(date, assignment.projectCalendar));
      const effectiveDates = workDates.length > 0 ? workDates : [start];
      const hoursPerScheduleDay = effort! / effectiveDates.length;
      const daily = allocationByResource.get(profile.resourceId)!;

      for (const date of effectiveDates) {
        if (date.getTime() < range.from.getTime() || date.getTime() > range.to.getTime()) continue;
        const key = dateOnly(date);
        daily.set(key, (daily.get(key) ?? 0) + hoursPerScheduleDay);
        allocatedHoursInRange += hoursPerScheduleDay;
      }
    }

    assignmentRows.get(profile.resourceId)!.push({
      objectId: assignment.objectId,
      title: assignment.title,
      ...(assignment.projectId ? { projectId: assignment.projectId } : {}),
      ...(sized ? { effortHours: roundHours(effort!) } : {}),
      allocatedHoursInRange: roundHours(allocatedHoursInRange),
      ...(assignment.startDate ? { startDate: dateOnly(assignment.startDate) } : {}),
      ...(assignment.dueDate ? { dueDate: dateOnly(assignment.dueDate) } : {}),
      sized,
      scheduled,
    });
  }

  const resources = profiles.map((profile): ResourceCapacityResult => {
    const calendar = resourceCalendar(profile);
    const dailyAllocations = allocationByResource.get(profile.resourceId) ?? new Map<string, number>();
    const weekMap = new Map<string, { capacity: number; allocated: number; over: number }>();
    let capacityHours = 0;
    let allocatedHours = 0;
    let overallocatedHours = 0;

    for (const date of rangeDates) {
      const key = dateOnly(date);
      const dailyCapacity = isWorkingDate(date, calendar) ? Math.max(0, profile.capacityHoursPerDay) : 0;
      const dailyAllocated = dailyAllocations.get(key) ?? 0;
      const dailyOver = Math.max(0, dailyAllocated - dailyCapacity);
      const week = weekStart(date);
      const bucket = weekMap.get(week) ?? { capacity: 0, allocated: 0, over: 0 };
      bucket.capacity += dailyCapacity;
      bucket.allocated += dailyAllocated;
      bucket.over += dailyOver;
      weekMap.set(week, bucket);
      capacityHours += dailyCapacity;
      allocatedHours += dailyAllocated;
      overallocatedHours += dailyOver;
    }

    const weeks = [...weekMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([start, values]) => ({
        weekStart: start,
        capacityHours: roundHours(values.capacity),
        allocatedHours: roundHours(values.allocated),
        utilizationPct: pct(values.allocated, values.capacity),
        overallocatedHours: roundHours(values.over),
      }));

    return {
      resourceId: profile.resourceId,
      ...(profile.linkedUserId ? { linkedUserId: profile.linkedUserId } : {}),
      name: profile.name,
      capacityHoursPerDay: roundHours(profile.capacityHoursPerDay),
      capacityHours: roundHours(capacityHours),
      allocatedHours: roundHours(allocatedHours),
      utilizationPct: pct(allocatedHours, capacityHours),
      overallocatedHours: roundHours(overallocatedHours),
      unsizedItems: unsizedByResource.get(profile.resourceId) ?? 0,
      unscheduledItems: unscheduledByResource.get(profile.resourceId) ?? 0,
      weeks,
      assignments: (assignmentRows.get(profile.resourceId) ?? []).sort((a, b) => {
        const aStart = a.startDate ?? '9999-12-31';
        const bStart = b.startDate ?? '9999-12-31';
        return aStart.localeCompare(bStart) || a.title.localeCompare(b.title);
      }),
    };
  });

  return {
    from: dateOnly(range.from),
    to: dateOnly(range.to),
    resources: resources.sort((a, b) => b.utilizationPct - a.utilizationPct || a.name.localeCompare(b.name)),
    unprofiledAssignments,
    unprofiledSizedHours: roundHours(unprofiledSizedHours),
  };
}
