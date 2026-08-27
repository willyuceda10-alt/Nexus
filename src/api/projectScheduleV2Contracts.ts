import type { ApiDependencyType } from './contracts';

export type ApiSchedulingModeV2 = 'AUTO' | 'MANUAL';
export type ApiScheduleConstraintTypeV2 =
  | 'AS_SOON_AS_POSSIBLE'
  | 'AS_LATE_AS_POSSIBLE'
  | 'MUST_START_ON'
  | 'MUST_FINISH_ON'
  | 'START_NO_EARLIER_THAN'
  | 'START_NO_LATER_THAN'
  | 'FINISH_NO_EARLIER_THAN'
  | 'FINISH_NO_LATER_THAN';

export interface ApiWbsV2Node {
  objectId: string;
  title: string;
  objectTypeKey: 'TASK' | 'DELIVERABLE' | 'MILESTONE';
  status: string;
  priority: string;
  progress: number;
  assigneeId: string | null;
  assigneeName: string | null;
  parentWorkItemId: string | null;
  outlineLevel: number;
  sortOrder: number;
  wbsCode: string;
  isSummary: boolean;
  source: 'V2' | 'V1_FALLBACK';
  schedulingMode: ApiSchedulingModeV2;
  durationMinutes: number;
  remainingDurationMinutes: number;
  constraintType: ApiScheduleConstraintTypeV2;
  constraintDate: string | null;
  actualStart: string | null;
  actualFinish: string | null;
  physicalPercentComplete: number | null;
  legacyStart: string | null;
  legacyFinish: string | null;
}

export interface ApiWbsV2Response {
  project: {
    id: string;
    title: string;
    workspaceId: string;
    plannedStart: string | null;
    targetFinish: string | null;
  };
  minutesPerDay: number;
  nodes: ApiWbsV2Node[];
  migration: {
    total: number;
    typed: number;
    fallback: number;
  };
}

export interface UpdateApiWbsV2Input {
  items: Array<{
    objectId: string;
    parentWorkItemId?: string | null;
  }>;
}

export interface UpdateApiWbsV2Response {
  projectId: string;
  itemCount: number;
  createdScheduleCount: number;
  updatedScheduleCount: number;
  items: Array<{
    objectId: string;
    parentWorkItemId: string | null;
    outlineLevel: number;
    sortOrder: number;
    wbsCode: string;
    isSummary: boolean;
  }>;
}

export interface UpdateApiWorkItemScheduleV2Input {
  parentWorkItemId?: string | null;
  wbsCode?: string | null;
  outlineLevel?: number;
  sortOrder?: number;
  schedulingMode?: ApiSchedulingModeV2;
  durationMinutes?: number;
  remainingDurationMinutes?: number;
  constraintType?: ApiScheduleConstraintTypeV2;
  constraintDate?: string | null;
  actualStart?: string | null;
  actualFinish?: string | null;
  physicalPercentComplete?: number | null;
}

export interface ApiWorkItemScheduleV2 {
  id: string;
  objectId: string;
  projectObjectId: string;
  parentWorkItemId: string | null;
  wbsCode: string | null;
  outlineLevel: number;
  sortOrder: number;
  schedulingMode: ApiSchedulingModeV2;
  durationMinutes: number;
  remainingDurationMinutes: number;
  constraintType: ApiScheduleConstraintTypeV2;
  constraintDate: string | null;
  actualStart: string | null;
  actualFinish: string | null;
  physicalPercentComplete: number | null;
}

export interface ApiScheduleAnalysisV2Task {
  id: string;
  title?: string;
  durationMinutes: number;
  earlyStartMinutes: number;
  earlyFinishMinutes: number;
  lateStartMinutes: number;
  lateFinishMinutes: number;
  totalFloatMinutes: number;
  freeFloatMinutes: number;
  critical: boolean;
  scheduledStartMinutes: number;
  scheduledFinishMinutes: number;
  plannedStart: string;
  plannedFinish: string;
  durationWorkingDays: number;
  totalFloatWorkingDays: number;
  freeFloatWorkingDays: number;
  constraintType: ApiScheduleConstraintTypeV2;
  constraintDate?: string;
  schedulingMode: ApiSchedulingModeV2;
  scheduleSource: 'V2' | 'V1_FALLBACK';
}

export interface ApiScheduleAnalysisV2Dependency {
  id?: string;
  predecessorId: string;
  successorId: string;
  type: ApiDependencyType;
  lagMinutes: number;
  source: 'V2' | 'V1_FALLBACK';
}

export interface ApiScheduleAnalysisV2 {
  projectId: string;
  projectTitle: string;
  workspaceId: string;
  profileSource: 'V2' | 'V1_FALLBACK';
  calendar: {
    id: string | null;
    source: 'V2' | 'V1_FALLBACK';
    timezone: string;
    workingWeekdays: number[];
    minutesPerDay: number;
    exceptionCount: number;
  };
  migration: {
    totalWorkItems: number;
    v2WorkItems: number;
    fallbackWorkItems: number;
    v2Dependencies: number;
    fallbackDependencies: number;
  };
  engine: 'PROJECT_ENGINE_V2';
  anchorDate: string;
  targetFinish?: string;
  naturalFinishMinutes: number;
  scheduledProjectFinishMinutes: number;
  naturalFinish: string;
  scheduledProjectFinish: string;
  projectDurationWorkingDays: number;
  criticalTaskIds: string[];
  topologicalOrder: string[];
  tasks: ApiScheduleAnalysisV2Task[];
  dependencies: ApiScheduleAnalysisV2Dependency[];
  violations: Array<{
    type: string;
    taskId?: string;
    [key: string]: unknown;
  }>;
  feasible: boolean;
  unscheduledObjectIds: string[];
  calculatedAt: string;
}

export interface ApiProjectEngineV2BackfillResponse {
  tenantId: string;
  dryRun: boolean;
  requestedProjectId: string | null;
  projectCount: number;
  projects: Array<{
    projectId: string;
    projectTitle: string;
    calendar: string;
    profile: string;
    workItemsPlanned: number;
    workItemsCreated: number;
    workItemsSkippedExisting: number;
    workItemsSkippedUnscheduled: number;
    dependenciesPlanned: number;
    dependenciesCreated: number;
    dependenciesSkippedExisting: number;
  }>;
}
