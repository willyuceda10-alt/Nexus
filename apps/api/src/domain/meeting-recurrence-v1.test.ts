import { describe, expect, it } from 'vitest';
import { expandMeetingRecurrenceV1, toGraphRecurrenceV1, type MeetingRecurrenceRuleV1 } from './meeting-recurrence-v1.js';

const start = new Date('2026-08-31T15:00:00.000Z'); // 10:00 America/Lima
const end = new Date('2026-08-31T16:00:00.000Z');

function rule(overrides: Partial<MeetingRecurrenceRuleV1>): MeetingRecurrenceRuleV1 {
  return {
    patternType: 'DAILY', interval: 1, rangeType: 'NUMBERED', numberOfOccurrences: 3, timezone: 'America/Lima', ...overrides,
  };
}

describe('expandMeetingRecurrenceV1', () => {
  it('expands a numbered daily recurrence at the same Lima clock time', () => {
    const occurrences = expandMeetingRecurrenceV1(start, end, rule({}));
    expect(occurrences.map((item) => item.occurrenceDate)).toEqual(['2026-08-31', '2026-09-01', '2026-09-02']);
    expect(occurrences.map((item) => item.startAt.toISOString())).toEqual([
      '2026-08-31T15:00:00.000Z', '2026-09-01T15:00:00.000Z', '2026-09-02T15:00:00.000Z',
    ]);
  });

  it('expands a weekly rule only on configured weekdays', () => {
    const occurrences = expandMeetingRecurrenceV1(start, end, rule({
      patternType: 'WEEKLY', daysOfWeek: ['MONDAY', 'WEDNESDAY'], numberOfOccurrences: 4,
    }));
    expect(occurrences.map((item) => item.occurrenceDate)).toEqual(['2026-08-31', '2026-09-02', '2026-09-07', '2026-09-09']);
  });

  it('expands an absolute monthly recurrence on a verified day 1 through 28', () => {
    const monthlyStart = new Date('2027-01-15T15:00:00.000Z');
    const monthlyEnd = new Date('2027-01-15T16:00:00.000Z');
    const occurrences = expandMeetingRecurrenceV1(monthlyStart, monthlyEnd, rule({
      patternType: 'ABSOLUTE_MONTHLY', dayOfMonth: 15, numberOfOccurrences: 3,
    }));
    expect(occurrences.map((item) => item.occurrenceDate)).toEqual(['2027-01-15', '2027-02-15', '2027-03-15']);
  });

  it('rejects monthly days above the verified V1 range', () => {
    const monthlyStart = new Date('2027-01-31T15:00:00.000Z');
    const monthlyEnd = new Date('2027-01-31T16:00:00.000Z');
    expect(() => expandMeetingRecurrenceV1(monthlyStart, monthlyEnd, rule({
      patternType: 'ABSOLUTE_MONTHLY', dayOfMonth: 31,
    }))).toThrow(/between 1 and 28/i);
  });

  it('rejects weekly rules whose first date is not part of the selected weekdays', () => {
    expect(() => expandMeetingRecurrenceV1(start, end, rule({ patternType: 'WEEKLY', daysOfWeek: ['TUESDAY'] })))
      .toThrow(/first meeting date/i);
  });
});

describe('toGraphRecurrenceV1', () => {
  it('maps the V1 weekly rule to Microsoft Graph patternedRecurrence fields', () => {
    const graph = toGraphRecurrenceV1(rule({
      patternType: 'WEEKLY', interval: 2, daysOfWeek: ['MONDAY', 'WEDNESDAY'], rangeType: 'END_DATE', endDate: '2026-10-31',
    }), '2026-08-31');
    expect(graph).toEqual({
      pattern: { type: 'weekly', interval: 2, daysOfWeek: ['monday', 'wednesday'], firstDayOfWeek: 'monday' },
      range: { type: 'endDate', startDate: '2026-08-31', endDate: '2026-10-31', recurrenceTimeZone: 'SA Pacific Standard Time' },
    });
  });
});