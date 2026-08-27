import { describe, expect, it } from 'vitest';
import {
  MeetingAvailabilityValidationError,
  findCommonFreeSlotsV1,
} from './meeting-availability-v1.js';

describe('Meeting Availability V1', () => {
  const startAt = new Date('2026-08-27T13:00:00.000Z');
  const endAt = new Date('2026-08-27T17:00:00.000Z');

  it('returns only intervals where every participant is free', () => {
    const result = findCommonFreeSlotsV1({
      startAt,
      endAt,
      intervalMinutes: 30,
      durationMinutes: 60,
      availabilityViews: [
        '00220000',
        '00002200',
      ],
    });

    expect(result).toEqual([
      { start: '2026-08-27T13:00:00.000Z', end: '2026-08-27T14:00:00.000Z' },
      { start: '2026-08-27T16:00:00.000Z', end: '2026-08-27T17:00:00.000Z' },
    ]);
  });

  it('treats tentative, busy, oof and unknown as unavailable', () => {
    const result = findCommonFreeSlotsV1({
      startAt,
      endAt: new Date('2026-08-27T15:00:00.000Z'),
      intervalMinutes: 30,
      durationMinutes: 30,
      availabilityViews: ['01234000'],
    });
    expect(result.map((slot) => slot.start)).toEqual(['2026-08-27T13:00:00.000Z']);
  });

  it('rejects incompatible duration and interval', () => {
    expect(() => findCommonFreeSlotsV1({
      startAt,
      endAt,
      intervalMinutes: 30,
      durationMinutes: 45,
      availabilityViews: ['00000000'],
    })).toThrow(MeetingAvailabilityValidationError);
  });
});
