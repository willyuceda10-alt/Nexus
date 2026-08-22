import { describe, expect, it } from 'vitest';
import { forecastTask, summarizeForecast } from './forecast.js';
import { calendarFromMetadata } from './work-calendar.js';

function utc(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

const calendarDays = calendarFromMetadata(null);
const workingDays = calendarFromMetadata({
  scheduleCalendarMode: 'WORKING_DAYS_V1',
  scheduleWorkingWeekdays: [1, 2, 3, 4, 5],
  scheduleHolidays: [],
});

describe('forecastTask', () => {
  it('projects remaining work from observed progress velocity', () => {
    const result = forecastTask({
      id: 'A',
      title: 'A',
      objectTypeKey: 'TASK',
      status: 'IN_PROGRESS',
      progress: 50,
      startDate: utc('2026-08-18'),
      dueDate: utc('2026-08-30'),
    }, utc('2026-08-21'), calendarDays);

    expect(result).toMatchObject({
      basis: 'PROGRESS_VELOCITY',
      elapsedUnits: 4,
      remainingUnits: 4,
      forecastFinish: '2026-08-25',
      forecastVarianceDays: -5,
      observedProgressPerUnit: 12.5,
    });
  });

  it('respects working days when projecting the finish', () => {
    const result = forecastTask({
      id: 'A',
      title: 'A',
      objectTypeKey: 'TASK',
      status: 'IN_PROGRESS',
      progress: 50,
      startDate: utc('2026-08-17'),
      dueDate: utc('2026-08-28'),
    }, utc('2026-08-21'), workingDays);

    expect(result.elapsedUnits).toBe(5);
    expect(result.remainingUnits).toBe(5);
    expect(result.forecastFinish).toBe('2026-08-28');
    expect(result.forecastVarianceDays).toBe(0);
    expect(result.confidence).toBe('MEDIUM');
  });

  it('does not invent velocity when progress is zero', () => {
    const result = forecastTask({
      id: 'B',
      title: 'B',
      objectTypeKey: 'TASK',
      status: 'IN_PROGRESS',
      progress: 0,
      startDate: utc('2026-08-18'),
      dueDate: utc('2026-08-30'),
    }, utc('2026-08-21'), calendarDays);

    expect(result.basis).toBe('NO_PROGRESS_SIGNAL');
    expect(result.forecastFinish).toBe('2026-08-30');
    expect(result.observedProgressPerUnit).toBeNull();
  });

  it('keeps future work on plan until execution history exists', () => {
    const result = forecastTask({
      id: 'C',
      title: 'C',
      objectTypeKey: 'TASK',
      status: 'PLANNING',
      progress: 0,
      startDate: utc('2026-09-01'),
      dueDate: utc('2026-09-10'),
    }, utc('2026-08-21'), calendarDays);

    expect(result.basis).toBe('NOT_STARTED_PLAN');
    expect(result.forecastFinish).toBe('2026-09-10');
  });
});

describe('summarizeForecast', () => {
  it('uses the latest task finish for the project projection', () => {
    const tasks = [
      forecastTask({
        id: 'A', title: 'A', objectTypeKey: 'TASK', status: 'IN_PROGRESS', progress: 50,
        startDate: utc('2026-08-18'), dueDate: utc('2026-08-30'),
      }, utc('2026-08-21'), calendarDays),
      forecastTask({
        id: 'B', title: 'B', objectTypeKey: 'TASK', status: 'PLANNING', progress: 0,
        startDate: utc('2026-09-01'), dueDate: utc('2026-09-10'),
      }, utc('2026-08-21'), calendarDays),
    ];

    expect(summarizeForecast(tasks, calendarDays)).toMatchObject({
      plannedFinish: '2026-09-10',
      forecastFinish: '2026-09-10',
      forecastVarianceDays: 0,
      projectedTaskCount: 1,
    });
  });
});
