const DAY_MS = 86_400_000;

export type ScheduleCalendarMode = 'CALENDAR_DAYS_V1' | 'WORKING_DAYS_V1';

export interface ScheduleCalendarConfig {
  mode: ScheduleCalendarMode;
  workingWeekdays: number[];
  holidays: string[];
}

export const DEFAULT_WORKING_WEEKDAYS = [1, 2, 3, 4, 5] as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeWeekdays(value: unknown): number[] {
  if (!Array.isArray(value)) return [...DEFAULT_WORKING_WEEKDAYS];
  const normalized = [...new Set(
    value
      .filter((item): item is number => typeof item === 'number' && Number.isInteger(item))
      .filter((item) => item >= 0 && item <= 6),
  )].sort((a, b) => a - b);
  return normalized.length > 0 ? normalized : [...DEFAULT_WORKING_WEEKDAYS];
}

function normalizeHolidays(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.slice(0, 10))
      .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item)),
  )].sort();
}

export function calendarFromMetadata(value: unknown): ScheduleCalendarConfig {
  const metadata = asRecord(value);
  const mode: ScheduleCalendarMode = metadata.scheduleCalendarMode === 'WORKING_DAYS_V1'
    ? 'WORKING_DAYS_V1'
    : 'CALENDAR_DAYS_V1';

  return {
    mode,
    workingWeekdays: normalizeWeekdays(metadata.scheduleWorkingWeekdays),
    holidays: normalizeHolidays(metadata.scheduleHolidays),
  };
}

export function dateOnlyUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isWorkingDate(date: Date, calendar: ScheduleCalendarConfig): boolean {
  if (calendar.mode === 'CALENDAR_DAYS_V1') return true;
  if (!calendar.workingWeekdays.includes(date.getUTCDay())) return false;
  return !calendar.holidays.includes(dateOnlyUtc(date));
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

export function addScheduleUnits(
  from: Date,
  units: number,
  calendar: ScheduleCalendarConfig,
): Date {
  const wholeUnits = Math.trunc(units);
  if (wholeUnits === 0) return new Date(from.getTime());
  if (calendar.mode === 'CALENDAR_DAYS_V1') {
    return new Date(from.getTime() + wholeUnits * DAY_MS);
  }

  const direction = wholeUnits > 0 ? 1 : -1;
  const target = Math.abs(wholeUnits);
  let counted = 0;
  let cursor = new Date(from.getTime());

  while (counted < target) {
    cursor = new Date(cursor.getTime() + direction * DAY_MS);
    if (isWorkingDate(cursor, calendar)) counted += 1;
  }

  return cursor;
}
