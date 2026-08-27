export type RecurrencePatternTypeV1 = 'DAILY' | 'WEEKLY' | 'ABSOLUTE_MONTHLY';
export type RecurrenceRangeTypeV1 = 'NUMBERED' | 'END_DATE';
export type RecurrenceDayV1 = 'SUNDAY' | 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY';

export interface MeetingRecurrenceRuleV1 {
  patternType: RecurrencePatternTypeV1;
  interval: number;
  daysOfWeek?: RecurrenceDayV1[];
  dayOfMonth?: number;
  rangeType: RecurrenceRangeTypeV1;
  numberOfOccurrences?: number;
  endDate?: string;
  timezone: 'America/Lima';
}

export interface ExpandedMeetingOccurrenceV1 {
  sequence: number;
  occurrenceDate: string;
  startAt: Date;
  endAt: Date;
}

const LIMA_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_NAMES: RecurrenceDayV1[] = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const MAX_OCCURRENCES_V1 = 120;
const MAX_RANGE_DAYS_V1 = 366;

function pad(value: number): string { return String(value).padStart(2, '0'); }
function dateKey(year: number, monthIndex: number, day: number): string { return `${year}-${pad(monthIndex + 1)}-${pad(day)}`; }
function localClock(date: Date) {
  const local = new Date(date.getTime() - LIMA_OFFSET_MS);
  return { year: local.getUTCFullYear(), monthIndex: local.getUTCMonth(), day: local.getUTCDate(), hour: local.getUTCHours(), minute: local.getUTCMinutes(), second: local.getUTCSeconds(), millisecond: local.getUTCMilliseconds() };
}
function limaDateTime(year: number, monthIndex: number, day: number, clock: ReturnType<typeof localClock>): Date {
  return new Date(Date.UTC(year, monthIndex, day, clock.hour, clock.minute, clock.second, clock.millisecond) + LIMA_OFFSET_MS);
}
function daysInMonth(year: number, monthIndex: number): number { return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate(); }
function parseDateKey(value: string): { year: number; monthIndex: number; day: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('endDate must use YYYY-MM-DD.');
  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText); const monthIndex = Number(monthText) - 1; const day = Number(dayText);
  const check = new Date(Date.UTC(year, monthIndex, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== monthIndex || check.getUTCDate() !== day) throw new Error('endDate is not a valid calendar date.');
  return { year, monthIndex, day };
}
function dayIndexFromDateKey(value: string): number {
  const parsed = parseDateKey(value);
  return Math.floor(Date.UTC(parsed.year, parsed.monthIndex, parsed.day) / DAY_MS);
}
function localDateFromDate(date: Date): { year: number; monthIndex: number; day: number; key: string; dayIndex: number; weekday: RecurrenceDayV1 } {
  const p = localClock(date);
  const key = dateKey(p.year, p.monthIndex, p.day);
  const utcDate = new Date(Date.UTC(p.year, p.monthIndex, p.day));
  return { year: p.year, monthIndex: p.monthIndex, day: p.day, key, dayIndex: Math.floor(utcDate.getTime() / DAY_MS), weekday: DAY_NAMES[utcDate.getUTCDay()]! };
}

export function expandMeetingRecurrenceV1(startAt: Date, endAt: Date, rule: MeetingRecurrenceRuleV1): ExpandedMeetingOccurrenceV1[] {
  if (rule.timezone !== 'America/Lima') throw new Error('Recurring Meetings V1 supports America/Lima only.');
  if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > 99) throw new Error('interval must be between 1 and 99.');
  const durationMs = endAt.getTime() - startAt.getTime();
  if (!(durationMs > 0) || durationMs > 8 * 60 * 60 * 1000) throw new Error('Meeting duration must be greater than 0 and no more than 8 hours.');
  const first = localDateFromDate(startAt);
  const clock = localClock(startAt);
  let endDayIndex: number | null = null;
  let targetCount: number | null = null;
  if (rule.rangeType === 'NUMBERED') {
    if (!Number.isInteger(rule.numberOfOccurrences) || (rule.numberOfOccurrences ?? 0) < 2 || (rule.numberOfOccurrences ?? 0) > MAX_OCCURRENCES_V1) throw new Error(`numberOfOccurrences must be between 2 and ${MAX_OCCURRENCES_V1}.`);
    targetCount = rule.numberOfOccurrences!;
  } else {
    if (!rule.endDate) throw new Error('endDate is required for END_DATE range.');
    endDayIndex = dayIndexFromDateKey(rule.endDate);
    if (endDayIndex < first.dayIndex) throw new Error('endDate must be on or after the first occurrence date.');
    if (endDayIndex - first.dayIndex > MAX_RANGE_DAYS_V1) throw new Error(`END_DATE range cannot exceed ${MAX_RANGE_DAYS_V1} days in V1.`);
  }
  const result: ExpandedMeetingOccurrenceV1[] = [];
  const push = (year: number, monthIndex: number, day: number) => {
    const key = dateKey(year, monthIndex, day);
    const index = dayIndexFromDateKey(key);
    if (endDayIndex != null && index > endDayIndex) return false;
    const occurrenceStart = limaDateTime(year, monthIndex, day, clock);
    result.push({ sequence: result.length + 1, occurrenceDate: key, startAt: occurrenceStart, endAt: new Date(occurrenceStart.getTime() + durationMs) });
    return targetCount == null || result.length < targetCount;
  };

  if (rule.patternType === 'DAILY') {
    for (let cursor = first.dayIndex; result.length < MAX_OCCURRENCES_V1; cursor += rule.interval) {
      if (endDayIndex != null && cursor > endDayIndex) break;
      const d = new Date(cursor * DAY_MS);
      if (!push(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) break;
    }
  } else if (rule.patternType === 'WEEKLY') {
    const days = [...new Set(rule.daysOfWeek ?? [])];
    if (!days.length) throw new Error('daysOfWeek is required for WEEKLY recurrence.');
    if (!days.includes(first.weekday)) throw new Error('The first meeting date must be included in daysOfWeek for WEEKLY recurrence in V1.');
    const selected = new Set(days);
    const mondayOffset = (new Date(first.dayIndex * DAY_MS).getUTCDay() + 6) % 7;
    const firstWeekMonday = first.dayIndex - mondayOffset;
    const hardStop = endDayIndex ?? first.dayIndex + MAX_RANGE_DAYS_V1;
    for (let cursor = first.dayIndex; cursor <= hardStop && result.length < MAX_OCCURRENCES_V1; cursor += 1) {
      const d = new Date(cursor * DAY_MS);
      const weekday = DAY_NAMES[d.getUTCDay()]!;
      const weeksSince = Math.floor((cursor - firstWeekMonday) / 7);
      if (weeksSince % rule.interval === 0 && selected.has(weekday)) {
        if (!push(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) break;
      }
    }
  } else {
    const dayOfMonth = rule.dayOfMonth;
    if (!Number.isInteger(dayOfMonth) || (dayOfMonth ?? 0) < 1 || (dayOfMonth ?? 0) > 31) throw new Error('dayOfMonth must be between 1 and 31 for ABSOLUTE_MONTHLY recurrence.');
    if (first.day !== dayOfMonth) throw new Error('The first meeting day must match dayOfMonth for ABSOLUTE_MONTHLY recurrence in V1.');
    for (let step = 0; result.length < MAX_OCCURRENCES_V1; step += 1) {
      const monthNumber = first.monthIndex + step * rule.interval;
      const year = first.year + Math.floor(monthNumber / 12);
      const monthIndex = ((monthNumber % 12) + 12) % 12;
      const effectiveDay = Math.min(dayOfMonth!, daysInMonth(year, monthIndex));
      if (!push(year, monthIndex, effectiveDay)) break;
      if (endDayIndex != null && dayIndexFromDateKey(dateKey(year, monthIndex, effectiveDay)) >= endDayIndex) break;
    }
  }
  if (!result.length) throw new Error('The recurrence rule produced no occurrences.');
  if (targetCount != null && result.length !== targetCount) throw new Error('The recurrence rule could not produce the requested number of occurrences within V1 limits.');
  return result;
}

export function toGraphRecurrenceV1(rule: MeetingRecurrenceRuleV1, firstOccurrenceDate: string): Record<string, unknown> {
  const pattern: Record<string, unknown> = { interval: rule.interval };
  if (rule.patternType === 'DAILY') pattern.type = 'daily';
  if (rule.patternType === 'WEEKLY') {
    pattern.type = 'weekly';
    pattern.daysOfWeek = (rule.daysOfWeek ?? []).map((day) => day.toLowerCase());
    pattern.firstDayOfWeek = 'monday';
  }
  if (rule.patternType === 'ABSOLUTE_MONTHLY') {
    pattern.type = 'absoluteMonthly';
    pattern.dayOfMonth = rule.dayOfMonth;
  }
  const range: Record<string, unknown> = { startDate: firstOccurrenceDate, recurrenceTimeZone: 'SA Pacific Standard Time' };
  if (rule.rangeType === 'NUMBERED') {
    range.type = 'numbered';
    range.numberOfOccurrences = rule.numberOfOccurrences;
  } else {
    range.type = 'endDate';
    range.endDate = rule.endDate;
  }
  return { pattern, range };
}
