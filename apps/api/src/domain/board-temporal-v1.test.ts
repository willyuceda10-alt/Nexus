import { describe, expect, it } from 'vitest';
import {
  BoardTemporalValidationError,
  normalizeTemporalRangeV1,
  validateBoardTemporalConfigV1,
} from './board-temporal-v1.js';

describe('Board Temporal V1', () => {
  const columns = [
    { fieldKey: 'startDate', dataType: 'DATE' },
    { fieldKey: 'dueDate', dataType: 'DATE' },
    { fieldKey: 'inspection_date', dataType: 'DATE' },
    { fieldKey: 'progress', dataType: 'PROGRESS' },
  ];

  it('accepts core and custom date fields', () => {
    expect(validateBoardTemporalConfigV1({ startFieldKey: 'startDate', endFieldKey: 'dueDate' }, columns)).toMatchObject({
      startFieldKey: 'startDate',
      endFieldKey: 'dueDate',
      titleFieldKey: 'title',
      allDay: true,
    });
    expect(validateBoardTemporalConfigV1({ startFieldKey: 'inspection_date' }, columns).startFieldKey).toBe('inspection_date');
  });

  it('rejects non-date, same field and unsafe paths', () => {
    expect(() => validateBoardTemporalConfigV1({ startFieldKey: 'progress' }, columns)).toThrow(BoardTemporalValidationError);
    expect(() => validateBoardTemporalConfigV1({ startFieldKey: 'startDate', endFieldKey: 'startDate' }, columns)).toThrow(BoardTemporalValidationError);
    expect(() => validateBoardTemporalConfigV1({ startFieldKey: '__proto__' }, columns)).toThrow(BoardTemporalValidationError);
  });

  it('clamps reversed ranges instead of rendering negative duration', () => {
    const result = normalizeTemporalRangeV1(new Date('2026-08-27T10:00:00Z'), new Date('2026-08-26T10:00:00Z'));
    expect(result.end.toISOString()).toBe(result.start.toISOString());
  });
});
