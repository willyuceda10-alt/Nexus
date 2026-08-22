import { describe, expect, it } from 'vitest';
import {
  calendarFromMetadata,
  durationUnits,
  isWorkingDate,
  signedScheduleDistance,
} from './work-calendar.js';

function utc(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

describe('working calendar', () => {
  it('defaults to calendar days when no project calendar is configured', () => {
    const calendar = calendarFromMetadata(null);
    expect(calendar.mode).toBe('CALENDAR_DAYS_V1');
    expect(durationUnits(utc('2026-08-21'), utc('2026-08-24'), calendar)).toBe(4);
    expect(signedScheduleDistance(utc('2026-08-21'), utc('2026-08-24'), calendar)).toBe(3);
  });

  it('counts only configured working weekdays and excludes holidays', () => {
    const calendar = calendarFromMetadata({
      scheduleCalendarMode: 'WORKING_DAYS_V1',
      scheduleWorkingWeekdays: [1, 2, 3, 4, 5],
      scheduleHolidays: ['2026-08-21'],
    });

    expect(calendar.mode).toBe('WORKING_DAYS_V1');
    expect(isWorkingDate(utc('2026-08-21'), calendar)).toBe(false);
    expect(isWorkingDate(utc('2026-08-22'), calendar)).toBe(false);
    expect(isWorkingDate(utc('2026-08-24'), calendar)).toBe(true);
    expect(durationUnits(utc('2026-08-18'), utc('2026-08-24'), calendar)).toBe(4);
  });

  it('computes signed baseline variance in working-day units', () => {
    const calendar = calendarFromMetadata({
      scheduleCalendarMode: 'WORKING_DAYS_V1',
      scheduleWorkingWeekdays: [1, 2, 3, 4, 5],
      scheduleHolidays: [],
    });

    expect(signedScheduleDistance(utc('2026-08-21'), utc('2026-08-24'), calendar)).toBe(1);
    expect(signedScheduleDistance(utc('2026-08-24'), utc('2026-08-21'), calendar)).toBe(-1);
  });

  it('normalizes invalid or duplicate calendar metadata', () => {
    const calendar = calendarFromMetadata({
      scheduleCalendarMode: 'WORKING_DAYS_V1',
      scheduleWorkingWeekdays: [1, 1, 9, -1],
      scheduleHolidays: ['2026-08-21', '2026-08-21', 'invalid'],
    });

    expect(calendar.workingWeekdays).toEqual([1]);
    expect(calendar.holidays).toEqual(['2026-08-21']);
  });
});
