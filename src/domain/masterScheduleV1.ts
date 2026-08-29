import type { ApiScheduleAnalysisV2 } from '../api/projectScheduleV2Contracts';
import type { NexusObject } from '../types/nexus';

const DAY_MS = 86_400_000;

export type MasterScheduleHealthV1 = 'ON_TRACK' | 'AT_RISK' | 'CRITICAL' | 'UNSCHEDULED';

export interface MasterScheduleProjectResultV1 {
  project: NexusObject;
  analysis: ApiScheduleAnalysisV2 | null;
  analysisError?: string | null;
}

export interface MasterScheduleRowV1 {
  projectId: string;
  title: string;
  status: NexusObject['status'];
  progress: number;
  startDate: string | null;
  finishDate: string | null;
  targetFinish: string | null;
  baselineStart: string | null;
  baselineFinish: string | null;
  varianceCalendarDays: number | null;
  durationWorkingDays: number | null;
  criticalTaskCount: number;
  unscheduledWorkItemCount: number;
  violationCount: number;
  fallbackWorkItemCount: number;
  engineSource: 'PROJECT_ENGINE_V2' | 'PROJECT_DATES_ONLY';
  health: MasterScheduleHealthV1;
  feasible: boolean | null;
  analysisError: string | null;
}

export interface MasterScheduleSummaryV1 {
  totalProjects: number;
  onTrackProjects: number;
  atRiskProjects: number;
  criticalProjects: number;
  unscheduledProjects: number;
  criticalTaskCount: number;
  unscheduledWorkItemCount: number;
}

export interface MasterScheduleRangeV1 {
  startDate: string;
  finishDate: string;
  totalDays: number;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function calendarDaysBetween(from: string, to: string): number {
  const left = parseDate(from);
  const right = parseDate(to);
  if (!left || !right) return 0;
  return Math.round((right.getTime() - left.getTime()) / DAY_MS);
}

function deriveHealth(input: {
  project: NexusObject;
  analysis: ApiScheduleAnalysisV2 | null;
  analysisError: string | null;
  startDate: string | null;
  finishDate: string | null;
  varianceCalendarDays: number | null;
}): MasterScheduleHealthV1 {
  const { project, analysis, analysisError, startDate, finishDate, varianceCalendarDays } = input;
  if (!startDate || !finishDate) return 'UNSCHEDULED';
  if (project.status === 'BLOCKED' || analysis?.feasible === false) return 'CRITICAL';
  if (
    analysisError
    || (varianceCalendarDays ?? 0) > 0
    || (analysis?.violations.length ?? 0) > 0
    || (analysis?.unscheduledObjectIds.length ?? 0) > 0
  ) {
    return 'AT_RISK';
  }
  return 'ON_TRACK';
}

export function buildMasterScheduleRowV1(input: MasterScheduleProjectResultV1): MasterScheduleRowV1 {
  const { project, analysis } = input;
  const analysisError = input.analysisError ?? null;
  const startDate = analysis?.anchorDate ?? project.startDate ?? project.baselineStartDate ?? null;
  const finishDate = analysis?.scheduledProjectFinish ?? project.endDate ?? project.baselineEndDate ?? startDate;
  const targetFinish = analysis?.targetFinish ?? project.endDate ?? null;
  const varianceCalendarDays = finishDate && targetFinish
    ? calendarDaysBetween(targetFinish, finishDate)
    : null;

  return {
    projectId: project.id,
    title: project.title,
    status: project.status,
    progress: project.progress,
    startDate,
    finishDate,
    targetFinish,
    baselineStart: project.baselineStartDate ?? null,
    baselineFinish: project.baselineEndDate ?? null,
    varianceCalendarDays,
    durationWorkingDays: analysis?.projectDurationWorkingDays ?? null,
    criticalTaskCount: analysis?.criticalTaskIds.length ?? 0,
    unscheduledWorkItemCount: analysis?.unscheduledObjectIds.length ?? 0,
    violationCount: analysis?.violations.length ?? 0,
    fallbackWorkItemCount: analysis?.migration.fallbackWorkItems ?? 0,
    engineSource: analysis ? 'PROJECT_ENGINE_V2' : 'PROJECT_DATES_ONLY',
    health: deriveHealth({ project, analysis, analysisError, startDate, finishDate, varianceCalendarDays }),
    feasible: analysis?.feasible ?? null,
    analysisError,
  };
}

export function buildMasterScheduleRowsV1(inputs: MasterScheduleProjectResultV1[]): MasterScheduleRowV1[] {
  return inputs
    .map(buildMasterScheduleRowV1)
    .sort((left, right) => {
      if (!left.startDate && !right.startDate) return left.title.localeCompare(right.title, 'es');
      if (!left.startDate) return 1;
      if (!right.startDate) return -1;
      const byStart = left.startDate.localeCompare(right.startDate);
      return byStart !== 0 ? byStart : left.title.localeCompare(right.title, 'es');
    });
}

export function summarizeMasterScheduleV1(rows: MasterScheduleRowV1[]): MasterScheduleSummaryV1 {
  return {
    totalProjects: rows.length,
    onTrackProjects: rows.filter((row) => row.health === 'ON_TRACK').length,
    atRiskProjects: rows.filter((row) => row.health === 'AT_RISK').length,
    criticalProjects: rows.filter((row) => row.health === 'CRITICAL').length,
    unscheduledProjects: rows.filter((row) => row.health === 'UNSCHEDULED').length,
    criticalTaskCount: rows.reduce((sum, row) => sum + row.criticalTaskCount, 0),
    unscheduledWorkItemCount: rows.reduce((sum, row) => sum + row.unscheduledWorkItemCount, 0),
  };
}

export function masterScheduleRangeV1(rows: MasterScheduleRowV1[], today = new Date()): MasterScheduleRangeV1 {
  const starts = rows.flatMap((row) => {
    const date = parseDate(row.startDate);
    const baseline = parseDate(row.baselineStart);
    return [date, baseline].filter((value): value is Date => value !== null);
  });
  const finishes = rows.flatMap((row) => {
    const date = parseDate(row.finishDate);
    const baseline = parseDate(row.baselineFinish);
    const target = parseDate(row.targetFinish);
    return [date, baseline, target].filter((value): value is Date => value !== null);
  });

  const defaultStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const defaultFinish = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 3, 0));
  const minStart = starts.length > 0
    ? new Date(Math.min(...starts.map((date) => date.getTime())))
    : defaultStart;
  const maxFinish = finishes.length > 0
    ? new Date(Math.max(...finishes.map((date) => date.getTime())))
    : defaultFinish;

  const paddedStart = new Date(minStart.getTime() - 7 * DAY_MS);
  const paddedFinish = new Date(Math.max(maxFinish.getTime(), paddedStart.getTime() + 30 * DAY_MS) + 7 * DAY_MS);
  return {
    startDate: dateOnly(paddedStart),
    finishDate: dateOnly(paddedFinish),
    totalDays: Math.max(1, Math.round((paddedFinish.getTime() - paddedStart.getTime()) / DAY_MS)),
  };
}

export function masterSchedulePositionV1(
  startDate: string | null,
  finishDate: string | null,
  range: MasterScheduleRangeV1,
): { leftPercent: number; widthPercent: number } | null {
  if (!startDate || !finishDate) return null;
  const rangeStart = parseDate(range.startDate);
  const start = parseDate(startDate);
  const finish = parseDate(finishDate);
  if (!rangeStart || !start || !finish) return null;

  const leftDays = Math.max(0, Math.round((start.getTime() - rangeStart.getTime()) / DAY_MS));
  const durationDays = Math.max(1, Math.round((finish.getTime() - start.getTime()) / DAY_MS) + 1);
  const leftPercent = Math.min(100, Math.max(0, (leftDays / range.totalDays) * 100));
  const widthPercent = Math.min(100 - leftPercent, Math.max(1.25, (durationDays / range.totalDays) * 100));
  return { leftPercent, widthPercent };
}
