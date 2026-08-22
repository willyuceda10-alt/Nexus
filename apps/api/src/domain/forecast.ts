import {
  addScheduleUnits,
  durationUnits,
  signedScheduleDistance,
  type ScheduleCalendarConfig,
} from './work-calendar.js';

export type ForecastBasis =
  | 'PROGRESS_VELOCITY'
  | 'NOT_STARTED_PLAN'
  | 'NO_PROGRESS_SIGNAL'
  | 'INSUFFICIENT_HISTORY'
  | 'COMPLETED_CURRENT_FINISH';

export type ForecastConfidence = 'LOW' | 'MEDIUM';

export interface ForecastTaskInput {
  id: string;
  title: string;
  objectTypeKey: string;
  status: string;
  progress: number;
  startDate: Date | null;
  dueDate: Date | null;
}

export interface ForecastTaskResult {
  id: string;
  title: string;
  objectTypeKey: string;
  status: string;
  progress: number;
  plannedFinish: string | null;
  forecastFinish: string | null;
  forecastVarianceDays: number | null;
  basis: ForecastBasis;
  confidence: ForecastConfidence;
  elapsedUnits: number | null;
  remainingUnits: number | null;
  observedProgressPerUnit: number | null;
}

function dateOnly(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.trunc(value)));
}

function resultWithPlan(
  task: ForecastTaskInput,
  basis: ForecastBasis,
): ForecastTaskResult {
  const progress = clampProgress(task.progress);
  const planned = task.dueDate ?? task.startDate;
  return {
    id: task.id,
    title: task.title,
    objectTypeKey: task.objectTypeKey,
    status: task.status,
    progress,
    plannedFinish: dateOnly(planned),
    forecastFinish: dateOnly(planned),
    forecastVarianceDays: planned ? 0 : null,
    basis,
    confidence: 'LOW',
    elapsedUnits: null,
    remainingUnits: null,
    observedProgressPerUnit: null,
  };
}

export function forecastTask(
  task: ForecastTaskInput,
  asOfDate: Date,
  calendar: ScheduleCalendarConfig,
): ForecastTaskResult {
  const progress = clampProgress(task.progress);
  const plannedFinish = task.dueDate ?? task.startDate;

  if (progress >= 100 || ['COMPLETED', 'APPROVED', 'CLOSED'].includes(task.status)) {
    return resultWithPlan(task, 'COMPLETED_CURRENT_FINISH');
  }

  if (!task.startDate) {
    return resultWithPlan(task, 'INSUFFICIENT_HISTORY');
  }

  if (asOfDate.getTime() < task.startDate.getTime()) {
    return resultWithPlan(task, 'NOT_STARTED_PLAN');
  }

  if (progress <= 0) {
    return resultWithPlan(task, 'NO_PROGRESS_SIGNAL');
  }

  const elapsedUnits = durationUnits(task.startDate, asOfDate, calendar);
  if (elapsedUnits <= 0) {
    return resultWithPlan(task, 'INSUFFICIENT_HISTORY');
  }

  const observedProgressPerUnit = progress / elapsedUnits;
  if (!Number.isFinite(observedProgressPerUnit) || observedProgressPerUnit <= 0) {
    return resultWithPlan(task, 'INSUFFICIENT_HISTORY');
  }

  const remainingProgress = 100 - progress;
  const remainingUnits = Math.max(1, Math.ceil(remainingProgress / observedProgressPerUnit));
  const forecastFinish = addScheduleUnits(asOfDate, remainingUnits, calendar);
  const variance = plannedFinish
    ? signedScheduleDistance(plannedFinish, forecastFinish, calendar)
    : null;

  return {
    id: task.id,
    title: task.title,
    objectTypeKey: task.objectTypeKey,
    status: task.status,
    progress,
    plannedFinish: dateOnly(plannedFinish),
    forecastFinish: dateOnly(forecastFinish),
    forecastVarianceDays: variance,
    basis: 'PROGRESS_VELOCITY',
    confidence: elapsedUnits >= 5 && progress >= 20 ? 'MEDIUM' : 'LOW',
    elapsedUnits,
    remainingUnits,
    observedProgressPerUnit: Number(observedProgressPerUnit.toFixed(4)),
  };
}

export function summarizeForecast(
  tasks: ForecastTaskResult[],
  calendar: ScheduleCalendarConfig,
): {
  plannedFinish: string | null;
  forecastFinish: string | null;
  forecastVarianceDays: number | null;
  projectedTaskCount: number;
  lowConfidenceTaskCount: number;
} {
  const plannedDates = tasks
    .map((task) => task.plannedFinish)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(`${value}T00:00:00.000Z`));
  const forecastDates = tasks
    .map((task) => task.forecastFinish)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(`${value}T00:00:00.000Z`));

  const plannedFinish = plannedDates.length
    ? new Date(Math.max(...plannedDates.map((date) => date.getTime())))
    : null;
  const forecastFinish = forecastDates.length
    ? new Date(Math.max(...forecastDates.map((date) => date.getTime())))
    : null;

  return {
    plannedFinish: dateOnly(plannedFinish),
    forecastFinish: dateOnly(forecastFinish),
    forecastVarianceDays: plannedFinish && forecastFinish
      ? signedScheduleDistance(plannedFinish, forecastFinish, calendar)
      : null,
    projectedTaskCount: tasks.filter((task) => task.basis === 'PROGRESS_VELOCITY').length,
    lowConfidenceTaskCount: tasks.filter((task) => task.confidence === 'LOW').length,
  };
}
