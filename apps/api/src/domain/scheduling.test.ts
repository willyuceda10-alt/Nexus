import { describe, expect, it } from 'vitest';
import {
  calculateCpm,
  ScheduleCycleError,
  ScheduleValidationError,
} from './scheduling.js';

describe('calculateCpm', () => {
  it('calculates a critical finish-to-start chain', () => {
    const result = calculateCpm(
      [
        { id: 'A', durationDays: 3 },
        { id: 'B', durationDays: 2 },
        { id: 'C', durationDays: 4 },
      ],
      [
        { predecessorId: 'A', successorId: 'B', type: 'FS' },
        { predecessorId: 'B', successorId: 'C', type: 'FS' },
      ],
    );

    expect(result.projectDurationDays).toBe(9);
    expect(result.criticalTaskIds).toEqual(['A', 'B', 'C']);
    expect(result.tasks.find((task) => task.id === 'C')).toMatchObject({
      earlyStart: 5,
      earlyFinish: 9,
      totalFloat: 0,
      critical: true,
    });
  });

  it('calculates float for a shorter parallel path', () => {
    const result = calculateCpm(
      [
        { id: 'A', durationDays: 3 },
        { id: 'B', durationDays: 1 },
        { id: 'C', durationDays: 2 },
      ],
      [
        { predecessorId: 'A', successorId: 'C', type: 'FS' },
        { predecessorId: 'B', successorId: 'C', type: 'FS' },
      ],
    );

    expect(result.projectDurationDays).toBe(5);
    expect(result.tasks.find((task) => task.id === 'B')).toMatchObject({
      totalFloat: 2,
      freeFloat: 2,
      critical: false,
    });
    expect(result.criticalTaskIds).toEqual(['A', 'C']);
  });

  it('supports SS, FF and lag constraints', () => {
    const ss = calculateCpm(
      [
        { id: 'A', durationDays: 5 },
        { id: 'B', durationDays: 3 },
      ],
      [{ predecessorId: 'A', successorId: 'B', type: 'SS', lagDays: 2 }],
    );
    expect(ss.tasks.find((task) => task.id === 'B')?.earlyStart).toBe(2);

    const ff = calculateCpm(
      [
        { id: 'A', durationDays: 5 },
        { id: 'B', durationDays: 2 },
      ],
      [{ predecessorId: 'A', successorId: 'B', type: 'FF', lagDays: 1 }],
    );
    expect(ff.tasks.find((task) => task.id === 'B')).toMatchObject({
      earlyStart: 4,
      earlyFinish: 6,
    });
    expect(ff.projectDurationDays).toBe(6);
  });

  it('supports lead as a negative lag', () => {
    const result = calculateCpm(
      [
        { id: 'A', durationDays: 5 },
        { id: 'B', durationDays: 3 },
      ],
      [{ predecessorId: 'A', successorId: 'B', type: 'FS', lagDays: -2 }],
    );

    expect(result.tasks.find((task) => task.id === 'B')?.earlyStart).toBe(3);
    expect(result.projectDurationDays).toBe(6);
  });

  it('rejects dependency cycles', () => {
    expect(() =>
      calculateCpm(
        [
          { id: 'A', durationDays: 1 },
          { id: 'B', durationDays: 1 },
        ],
        [
          { predecessorId: 'A', successorId: 'B', type: 'FS' },
          { predecessorId: 'B', successorId: 'A', type: 'FS' },
        ],
      ),
    ).toThrow(ScheduleCycleError);
  });

  it('rejects unknown task references', () => {
    expect(() =>
      calculateCpm(
        [{ id: 'A', durationDays: 1 }],
        [{ predecessorId: 'A', successorId: 'B', type: 'FS' }],
      ),
    ).toThrow(ScheduleValidationError);
  });
});
