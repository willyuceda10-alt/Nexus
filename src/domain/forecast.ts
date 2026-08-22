import type { ApiForecastTask, ApiProjectForecast } from '../api/contracts';
import type { NexusObject } from '../types/nexus';
import {
  addScheduleUnits,
  calendarFromProject,
  durationUnits,
  signedScheduleDistance,
} from './workCalendar';

function parseDate(value?: string): Date | null {
  return value ? new Date(`${value.slice(0, 10)}T00:00:00.000Z`) : null;
}

function dateOnly(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

function taskForecast(task: NexusObject, asOfDate: Date, project: NexusObject): ApiForecastTask {
  const progress = Math.max(0, Math.min(100, Math.trunc(task.progress)));
  const startDate = parseDate(task.startDate);
  const plannedFinishDate = parseDate(task.endDate) ?? startDate;
  const calendar = calendarFromProject(project);

  const planFallback = (
    basis: ApiForecastTask['basis'],
  ): ApiForecastTask => ({
    id: task.id,
    title: task.title,
    objectTypeKey: task.type,
    status: task.status,
    progress,
    plannedFinish: dateOnly(plannedFinishDate),
    forecastFinish: dateOnly(plannedFinishDate),
    forecastVarianceDays: plannedFinishDate ? 0 : null,
    basis,
    confidence: 'LOW',
    elapsedUnits: null,
    remainingUnits: null,
    observedProgressPerUnit: null,
  });

  if (progress >= 100 || ['COMPLETED', 'APPROVED', 'CLOSED'].includes(task.status)) {
    return planFallback('COMPLETED_CURRENT_FINISH');
  }
  if (!startDate) return planFallback('INSUFFICIENT_HISTORY');
  if (asOfDate.getTime() < startDate.getTime()) return planFallback('NOT_STARTED_PLAN');
  if (progress <= 0) return planFallback('NO_PROGRESS_SIGNAL');

  const elapsedUnits = durationUnits(startDate, asOfDate, calendar);
  const observedProgressPerUnit = progress / elapsedUnits;
  if (!Number.isFinite(observedProgressPerUnit) || observedProgressPerUnit <= 0) {
    return planFallback('INSUFFICIENT_HISTORY');
  }

  const remainingUnits = Math.max(1, Math.ceil((100 - progress) / observedProgressPerUnit));
  const forecastFinishDate = addScheduleUnits(asOfDate, remainingUnits, calendar);

  return {
    id: task.id,
    title: task.title,
    objectTypeKey: task.type,
    status: task.status,
    progress,
    plannedFinish: dateOnly(plannedFinishDate),
    forecastFinish: dateOnly(forecastFinishDate),
    forecastVarianceDays: plannedFinishDate
      ? signedScheduleDistance(plannedFinishDate, forecastFinishDate, calendar)
      : null,
    basis: 'PROGRESS_VELOCITY',
    confidence: elapsedUnits >= 5 && progress >= 20 ? 'MEDIUM' : 'LOW',
    elapsedUnits,
    remainingUnits,
    observedProgressPerUnit: Number(observedProgressPerUnit.toFixed(4)),
  };
}

export function calculateLocalForecast(
  projectId: string,
  workspaceId: string,
  objects: NexusObject[],
  asOfDate: Date,
): ApiProjectForecast {
  const project = objects.find((object) => object.id === projectId && object.type === 'PROJECT');
  if (!project) throw new Error('El proyecto no existe en la vista actual.');
  const calendar = calendarFromProject(project);
  const tasks = objects
    .filter((object) => object.projectId === projectId && ['TASK', 'DELIVERABLE', 'MILESTONE'].includes(object.type))
    .map((task) => taskForecast(task, asOfDate, project));

  const plannedDates = tasks.flatMap((task) => task.plannedFinish ? [parseDate(task.plannedFinish)!] : []);
  const forecastDates = tasks.flatMap((task) => task.forecastFinish ? [parseDate(task.forecastFinish)!] : []);
  const plannedFinishDate = plannedDates.length
    ? new Date(Math.max(...plannedDates.map((date) => date.getTime())))
    : null;
  const forecastFinishDate = forecastDates.length
    ? new Date(Math.max(...forecastDates.map((date) => date.getTime())))
    : null;

  return {
    projectId,
    workspaceId,
    method: 'PROGRESS_VELOCITY_V1',
    asOfDate: asOfDate.toISOString().slice(0, 10),
    calendar: calendar.mode,
    workingWeekdays: calendar.workingWeekdays,
    holidays: calendar.holidays,
    plannedFinish: dateOnly(plannedFinishDate),
    forecastFinish: dateOnly(forecastFinishDate),
    forecastVarianceDays: plannedFinishDate && forecastFinishDate
      ? signedScheduleDistance(plannedFinishDate, forecastFinishDate, calendar)
      : null,
    projectedTaskCount: tasks.filter((task) => task.basis === 'PROGRESS_VELOCITY').length,
    lowConfidenceTaskCount: tasks.filter((task) => task.confidence === 'LOW').length,
    tasks,
  };
}
