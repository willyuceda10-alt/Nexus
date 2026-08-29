import type { ApiScheduleAnalysisV2 } from '../api/projectScheduleV2Contracts';
import type { NexusObject } from '../types/nexus';
import {
  buildMasterScheduleRowsV1,
  masterSchedulePositionV1,
  masterScheduleRangeV1,
  summarizeMasterScheduleV1,
} from './masterScheduleV1';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function project(id: string, title: string, startDate?: string, endDate?: string): NexusObject {
  return {
    id,
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    type: 'PROJECT',
    title,
    description: '',
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    ownerId: 'user-1',
    ownerName: 'Usuario',
    ownerAvatar: '',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:00.000Z',
    progress: 50,
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  };
}

function analysis(projectId: string, overrides: Partial<ApiScheduleAnalysisV2> = {}): ApiScheduleAnalysisV2 {
  return {
    projectId,
    projectTitle: projectId,
    workspaceId: 'workspace-1',
    profileSource: 'V2',
    calendar: {
      id: 'calendar-1',
      source: 'V2',
      timezone: 'America/Lima',
      workingWeekdays: [1, 2, 3, 4, 5],
      minutesPerDay: 480,
      exceptionCount: 0,
      timeResolution: 'WORKING_MINUTES_DATE_BUCKETED_V2',
    },
    migration: {
      totalWorkItems: 10,
      v2WorkItems: 10,
      fallbackWorkItems: 0,
      summaryWorkItems: 0,
      v2Dependencies: 4,
      fallbackDependencies: 0,
    },
    engine: 'PROJECT_ENGINE_V2',
    anchorDate: '2026-09-01',
    targetFinish: '2026-09-30',
    naturalFinishMinutes: 9600,
    scheduledProjectFinishMinutes: 9600,
    naturalFinish: '2026-09-25',
    scheduledProjectFinish: '2026-09-25',
    projectDurationWorkingDays: 20,
    criticalTaskIds: ['task-1', 'task-2'],
    topologicalOrder: ['task-1', 'task-2'],
    tasks: [],
    dependencies: [],
    summaryObjectIds: [],
    violations: [],
    feasible: true,
    unscheduledObjectIds: [],
    calculatedAt: '2026-08-29T19:00:00.000Z',
    ...overrides,
  };
}

const onTrack = project('project-a', 'Proyecto A', '2026-09-01', '2026-09-30');
const atRisk = project('project-b', 'Proyecto B', '2026-09-05', '2026-09-20');
const unscheduled = project('project-c', 'Proyecto C');

const rows = buildMasterScheduleRowsV1([
  { project: atRisk, analysis: analysis('project-b', { scheduledProjectFinish: '2026-10-05', targetFinish: '2026-09-20', unscheduledObjectIds: ['task-x'] }) },
  { project: unscheduled, analysis: null, analysisError: 'schedule_anchor_missing' },
  { project: onTrack, analysis: analysis('project-a') },
]);

assert(rows[0]?.projectId === 'project-a', 'Rows must sort by scheduled start date.');
assert(rows[0]?.health === 'ON_TRACK', 'Feasible project inside target must be on track.');
assert(rows[1]?.health === 'AT_RISK', 'Late or incomplete project must be at risk.');
assert(rows[1]?.varianceCalendarDays === 15, 'Variance must be calculated from target to scheduled finish.');
assert(rows[2]?.health === 'UNSCHEDULED', 'Project without schedule dates must remain unscheduled.');
assert(rows[2]?.analysisError === 'schedule_anchor_missing', 'Schedule error must remain visible.');

const summary = summarizeMasterScheduleV1(rows);
assert(summary.totalProjects === 3, 'Summary must count all projects.');
assert(summary.onTrackProjects === 1, 'Summary must count on-track projects.');
assert(summary.atRiskProjects === 1, 'Summary must count at-risk projects.');
assert(summary.unscheduledProjects === 1, 'Summary must count unscheduled projects.');
assert(summary.criticalTaskCount === 4, 'Critical tasks must roll up across projects.');
assert(summary.unscheduledWorkItemCount === 1, 'Unscheduled work items must roll up across projects.');

const range = masterScheduleRangeV1(rows, new Date('2026-08-29T00:00:00.000Z'));
const position = masterSchedulePositionV1(rows[0]!.startDate, rows[0]!.finishDate, range);
assert(position && position.widthPercent > 0, 'Scheduled projects must receive a visible timeline bar.');

console.info(JSON.stringify({
  masterScheduleV1: 'PASS',
  projectEngineV2Rollup: true,
  truthfulUnscheduledState: true,
  targetVariance: true,
  workspaceSummary: true,
  timelinePositioning: true,
}));
