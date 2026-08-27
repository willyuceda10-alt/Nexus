const DAY_MS = 86_400_000;

export interface WorkCalendarExceptionV2 {
  exceptionDate: Date;
  isWorking: boolean;
  workingMinutes?: number | null;
}

export interface WorkCalendarV2 {
  timezone: string;
  workingWeekdays: number[];
  minutesPerDay: number;
  exceptions: WorkCalendarExceptionV2[];
}

interface CompiledWorkCalendarV2 {
  normalized: WorkCalendarV2;
  exceptionByDate: Map<string, WorkCalendarExceptionV2>;
  weekdaySet: Set<number>;
}

const compiledCalendarCache = new WeakMap<object, CompiledWorkCalendarV2>();

export class WorkCalendarV2ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkCalendarV2ValidationError';
  }
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function dateOnlyV2(date: Date): string {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(startOfUtcDay(date).getTime() + days * DAY_MS);
}

function normalizedWeekdays(value: number[]): number[] {
  return [...new Set(value)]
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort((a, b) => a - b);
}

export function validateWorkCalendarV2(calendar: WorkCalendarV2): WorkCalendarV2 {
  if (!calendar.timezone.trim()) {
    throw new WorkCalendarV2ValidationError('timezone is required.');
  }
  if (!Number.isInteger(calendar.minutesPerDay) || calendar.minutesPerDay <= 0) {
    throw new WorkCalendarV2ValidationError('minutesPerDay must be a positive integer.');
  }

  const weekdays = normalizedWeekdays(calendar.workingWeekdays);
  if (weekdays.length === 0) {
    throw new WorkCalendarV2ValidationError('At least one working weekday is required.');
  }

  for (const exception of calendar.exceptions) {
    if (Number.isNaN(exception.exceptionDate.getTime())) {
      throw new WorkCalendarV2ValidationError('Calendar exception date is invalid.');
    }
    if (
      exception.workingMinutes !== undefined &&
      exception.workingMinutes !== null &&
      (!Number.isInteger(exception.workingMinutes) || exception.workingMinutes < 0)
    ) {
      throw new WorkCalendarV2ValidationError(
        'workingMinutes on a calendar exception must be a non-negative integer.',
      );
    }
  }

  return {
    ...calendar,
    workingWeekdays: weekdays,
    exceptions: [...calendar.exceptions],
  };
}

function compileCalendar(calendar: WorkCalendarV2): CompiledWorkCalendarV2 {
  const cached = compiledCalendarCache.get(calendar);
  if (cached) return cached;

  const normalized = validateWorkCalendarV2(calendar);
  const compiled = {
    normalized,
    exceptionByDate: new Map(
      normalized.exceptions.map((entry) => [dateOnlyV2(entry.exceptionDate), entry]),
    ),
    weekdaySet: new Set(normalized.workingWeekdays),
  };
  compiledCalendarCache.set(calendar, compiled);
  return compiled;
}

function workingMinutesOnDateCompiled(date: Date, compiled: CompiledWorkCalendarV2): number {
  const exception = compiled.exceptionByDate.get(dateOnlyV2(date));
  if (exception) {
    if (!exception.isWorking) return 0;
    return exception.workingMinutes ?? compiled.normalized.minutesPerDay;
  }
  return compiled.weekdaySet.has(startOfUtcDay(date).getUTCDay())
    ? compiled.normalized.minutesPerDay
    : 0;
}

export function workingMinutesOnDateV2(date: Date, calendar: WorkCalendarV2): number {
  return workingMinutesOnDateCompiled(date, compileCalendar(calendar));
}

export function isWorkingDateV2(date: Date, calendar: WorkCalendarV2): boolean {
  return workingMinutesOnDateV2(date, calendar) > 0;
}

export function nextWorkingDateV2(
  date: Date,
  calendar: WorkCalendarV2,
  direction: 1 | -1 = 1,
): Date {
  const compiled = compileCalendar(calendar);
  let cursor = startOfUtcDay(date);
  for (let guard = 0; guard < 36600; guard += 1) {
    if (workingMinutesOnDateCompiled(cursor, compiled) > 0) return cursor;
    cursor = addUtcDays(cursor, direction);
  }
  throw new WorkCalendarV2ValidationError('Unable to find a working date within the calendar guard range.');
}

/**
 * Returns the working-minute offset from anchor to the start of target date.
 * Positive offsets move forward through working capacity; negative offsets move backward.
 */
export function workingMinuteOffsetV2(
  anchor: Date,
  target: Date,
  calendar: WorkCalendarV2,
): number {
  const compiled = compileCalendar(calendar);
  const from = startOfUtcDay(anchor);
  const to = startOfUtcDay(target);
  if (from.getTime() === to.getTime()) return 0;

  if (to.getTime() > from.getTime()) {
    let minutes = 0;
    for (let cursor = from; cursor.getTime() < to.getTime(); cursor = addUtcDays(cursor, 1)) {
      minutes += workingMinutesOnDateCompiled(cursor, compiled);
    }
    return minutes;
  }

  let minutes = 0;
  for (let cursor = addUtcDays(from, -1); cursor.getTime() >= to.getTime(); cursor = addUtcDays(cursor, -1)) {
    minutes += workingMinutesOnDateCompiled(cursor, compiled);
  }
  return -minutes;
}

/**
 * Calculates working capacity inclusively between two calendar dates.
 * Used by the V1 -> V2 compatibility path so edited V2 calendars can still
 * influence legacy work items before their typed schedule row is created.
 */
export function workingMinutesBetweenDatesV2(
  start: Date,
  finish: Date,
  calendar: WorkCalendarV2,
): number {
  const compiled = compileCalendar(calendar);
  const from = startOfUtcDay(start);
  const toCandidate = startOfUtcDay(finish);
  const to = toCandidate.getTime() < from.getTime() ? from : toCandidate;
  let minutes = 0;
  for (let cursor = from; cursor.getTime() <= to.getTime(); cursor = addUtcDays(cursor, 1)) {
    minutes += workingMinutesOnDateCompiled(cursor, compiled);
  }
  return minutes;
}

/**
 * Maps a working-minute offset to a calendar date. Offset 0 maps to the anchor date.
 * For positive offsets that land exactly at the end of a workday, the next working
 * date is returned because the offset represents the next scheduling instant.
 */
export function dateAtWorkingMinuteOffsetV2(
  anchor: Date,
  offsetMinutes: number,
  calendar: WorkCalendarV2,
): Date {
  if (!Number.isFinite(offsetMinutes)) {
    throw new WorkCalendarV2ValidationError('offsetMinutes must be finite.');
  }

  const compiled = compileCalendar(calendar);
  const whole = Math.trunc(offsetMinutes);
  if (whole === 0) return startOfUtcDay(anchor);

  if (whole > 0) {
    let remaining = whole;
    let cursor = startOfUtcDay(anchor);
    for (let guard = 0; guard < 36600; guard += 1) {
      const capacity = workingMinutesOnDateCompiled(cursor, compiled);
      if (capacity > 0) {
        if (remaining < capacity) return cursor;
        remaining -= capacity;
        if (remaining === 0) {
          cursor = addUtcDays(cursor, 1);
          for (let nextGuard = 0; nextGuard < 36600; nextGuard += 1) {
            if (workingMinutesOnDateCompiled(cursor, compiled) > 0) return cursor;
            cursor = addUtcDays(cursor, 1);
          }
        }
      }
      cursor = addUtcDays(cursor, 1);
    }
  } else {
    let remaining = Math.abs(whole);
    let cursor = addUtcDays(startOfUtcDay(anchor), -1);
    for (let guard = 0; guard < 36600; guard += 1) {
      const capacity = workingMinutesOnDateCompiled(cursor, compiled);
      if (capacity > 0) {
        if (remaining <= capacity) return cursor;
        remaining -= capacity;
      }
      cursor = addUtcDays(cursor, -1);
    }
  }

  throw new WorkCalendarV2ValidationError('Working-minute offset exceeded the calendar guard range.');
}

/**
 * Returns the inclusive finish date for a task that starts at startOffsetMinutes
 * and consumes durationMinutes of working capacity.
 */
export function finishDateForWorkV2(
  anchor: Date,
  startOffsetMinutes: number,
  durationMinutes: number,
  calendar: WorkCalendarV2,
): Date {
  if (!Number.isFinite(durationMinutes) || durationMinutes < 0) {
    throw new WorkCalendarV2ValidationError('durationMinutes must be finite and non-negative.');
  }
  if (durationMinutes === 0) {
    return dateAtWorkingMinuteOffsetV2(anchor, startOffsetMinutes, calendar);
  }

  return dateAtWorkingMinuteOffsetV2(
    anchor,
    startOffsetMinutes + Math.max(0, Math.trunc(durationMinutes) - 1),
    calendar,
  );
}

export function workingDaysEquivalentV2(minutes: number, calendar: WorkCalendarV2): number {
  if (!Number.isFinite(minutes)) return 0;
  return Math.round((minutes / calendar.minutesPerDay) * 100) / 100;
}
