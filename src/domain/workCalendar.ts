import type { NexusObject, ScheduleCalendarMode } from '../types/nexus';

const DAY_MS = 86_400_000;
export const DEFAULT_WORKING_WEEKDAYS = [1, 2, 3, 4, 5] as const;

export interface ScheduleCalendarConfig {
  mode: ScheduleCalendarMode;
  workingWeekdays: number[];
  holidays: string[];
}

function normalizeWeekdays(value?: number[]): number[] {
  if (!value) return [...DEFAULT_WORKING_WEEKDAYS];
  const normalized = [...new Set(value.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    .sort((a, b) => a - b);
  return normalized.length > 0 ? normalized : [...DEFAULT_WORKING_WEEKDAYS];
}

function normalizeHolidays(value?: string[]): string[] {
  if (!value) return [];
  return [...new Set(
    value
      .map((item) => item.slice(0, 10))
      .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item)),
  )].sort();
}

export function calendarFromProject(project: NexusObject | null | undefined): ScheduleCalendarConfig {
  return {
    mode: project?.scheduleCalendarMode === 'WORKING_DAYS_V1'
      ? 'WORKING_DAYS_V1'
      : 'CALENDAR_DAYS_V1',
    workingWeekdays: normalizeWeekdays(project?.scheduleWorkingWeekdays),
    holidays: normalizeHolidays(project?.scheduleHolidays),
  };
}

export function isWorkingDate(date: Date, calendar: ScheduleCalendarConfig): boolean {
  if (calendar.mode === 'CALENDAR_DAYS_V1') return true;
  if (!calendar.workingWeekdays.includes(date.getUTCDay())) return false;
  return !calendar.holidays.includes(date.toISOString().slice(0, 10));
}

export function durationUnits(
  start: Date,
  end: Date,
  calendar: ScheduleCalendarConfig,
): number {
  const safeEnd = end.getTime() < start.getTime() ? start : end;
  if (calendar.mode === 'CALENDAR_DAYS_V1') {
    return Math.max(1, Math.round((safeEnd.getTime() - start.getTime()) / DAY_MS) + 1);
  }

  let count = 0;
  for (
    let cursor = new Date(start.getTime());
    cursor.getTime() <= safeEnd.getTime();
    cursor = new Date(cursor.getTime() + DAY_MS)
  ) {
    if (isWorkingDate(cursor, calendar)) count += 1;
  }
  return Math.max(1, count);
}

export function signedScheduleDistance(
  from: Date,
  to: Date,
  calendar: ScheduleCalendarConfig,
): number {
  if (from.getTime() === to.getTime()) return 0;
  if (calendar.mode === 'CALENDAR_DAYS_V1') {
    return Math.round((to.getTime() - from.getTime()) / DAY_MS);
  }

  const direction = to.getTime() > from.getTime() ? 1 : -1;
  let cursor = new Date(from.getTime());
  let distance = 0;
  while (cursor.getTime() !== to.getTime()) {
    cursor = new Date(cursor.getTime() + direction * DAY_MS);
    if (isWorkingDate(cursor, calendar)) distance += direction;
  }
  return distance;
}
