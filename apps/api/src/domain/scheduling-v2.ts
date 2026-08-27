import type {
  ScheduleConstraintType,
  ScheduleDependencyType,
  SchedulingMode,
} from './project-schedule-v2.js';
import {
  dateAtWorkingMinuteOffsetV2,
  finishDateForWorkV2,
  workingDaysEquivalentV2,
  workingMinuteOffsetV2,
  workingMinutesOnDateV2,
  type WorkCalendarV2,
} from './work-calendar-v2.js';

export interface ScheduleTaskV2Input {
  id: string;
  title?: string;
  durationMinutes: number;
  schedulingMode: SchedulingMode;
  constraintType: ScheduleConstraintType;
  constraintDate?: Date;
}

export interface ScheduleDependencyV2Input {
  id?: string;
  predecessorId: string;
  successorId: string;
  type: ScheduleDependencyType;
  lagMinutes: number;
}

export interface ScheduleEngineV2Input {
  anchorDate: Date;
  targetFinish?: Date;
  calendar: WorkCalendarV2;
  tasks: ScheduleTaskV2Input[];
  dependencies: ScheduleDependencyV2Input[];
}

export type ScheduleViolationV2 =
  | {
      type: 'CONSTRAINT_MISSED';
      taskId: string;
      constraintType: ScheduleConstraintType;
      requiredStartOffsetMinutes: number;
      calculatedStartOffsetMinutes: number;
    }
  | {
      type: 'PROJECT_TARGET_MISSED';
      targetFinishOffsetMinutes: number;
      naturalFinishOffsetMinutes: number;
    }
  | {
      type: 'NEGATIVE_FLOAT';
      taskId: string;
      totalFloatMinutes: number;
    }
  | {
      type: 'MANUAL_WITHOUT_DATE_CONSTRAINT';
      taskId: string;
    };

export interface ScheduleTaskV2Result {
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
  constraintType: ScheduleConstraintType;
  constraintDate?: string;
  schedulingMode: SchedulingMode;
}

export interface ScheduleEngineV2Result {
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
  tasks: ScheduleTaskV2Result[];
  violations: ScheduleViolationV2[];
  feasible: boolean;
}

export class ScheduleEngineV2ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleEngineV2ValidationError';
  }
}

export class ScheduleEngineV2CycleError extends Error {
  readonly cycleNodeIds: string[];

  constructor(cycleNodeIds: string[]) {
    super(`Dependency graph contains a cycle involving: ${cycleNodeIds.join(', ')}`);
    this.name = 'ScheduleEngineV2CycleError';
    this.cycleNodeIds = cycleNodeIds;
  }
}

interface ConstraintBounds {
  lower?: number;
  upper?: number;
}

function finiteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new ScheduleEngineV2ValidationError(`${field} must be finite and non-negative.`);
  }
}

function dependencyWeight(
  dependency: ScheduleDependencyV2Input,
  predecessorDuration: number,
  successorDuration: number,
): number {
  switch (dependency.type) {
    case 'FS':
      return predecessorDuration + dependency.lagMinutes;
    case 'SS':
      return dependency.lagMinutes;
    case 'FF':
      return predecessorDuration + dependency.lagMinutes - successorDuration;
    case 'SF':
      return dependency.lagMinutes - successorDuration;
  }
}

function finishBoundaryOffset(
  anchorDate: Date,
  date: Date,
  calendar: WorkCalendarV2,
): number {
  const start = workingMinuteOffsetV2(anchorDate, date, calendar);
  return start + workingMinutesOnDateV2(date, calendar);
}

function constraintBounds(
  task: ScheduleTaskV2Input,
  anchorDate: Date,
  calendar: WorkCalendarV2,
): ConstraintBounds {
  if (task.constraintType === 'AS_SOON_AS_POSSIBLE' || task.constraintType === 'AS_LATE_AS_POSSIBLE') {
    return {};
  }
  if (!task.constraintDate) {
    throw new ScheduleEngineV2ValidationError(
      `${task.constraintType} on task ${task.id} requires constraintDate.`,
    );
  }

  const startOffset = workingMinuteOffsetV2(anchorDate, task.constraintDate, calendar);
  const finishOffset = finishBoundaryOffset(anchorDate, task.constraintDate, calendar);

  switch (task.constraintType) {
    case 'MUST_START_ON':
      return { lower: startOffset, upper: startOffset };
    case 'MUST_FINISH_ON': {
      const requiredStart = finishOffset - task.durationMinutes;
      return { lower: requiredStart, upper: requiredStart };
    }
    case 'START_NO_EARLIER_THAN':
      return { lower: startOffset };
    case 'START_NO_LATER_THAN':
      return { upper: startOffset };
    case 'FINISH_NO_EARLIER_THAN':
      return { lower: finishOffset - task.durationMinutes };
    case 'FINISH_NO_LATER_THAN':
      return { upper: finishOffset - task.durationMinutes };
    default:
      return {};
  }
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function calculateScheduleV2(input: ScheduleEngineV2Input): ScheduleEngineV2Result {
  const taskById = new Map<string, ScheduleTaskV2Input>();
  for (const task of input.tasks) {
    if (taskById.has(task.id)) {
      throw new ScheduleEngineV2ValidationError(`Duplicate task id: ${task.id}`);
    }
    finiteNonNegative(task.durationMinutes, `durationMinutes for ${task.id}`);
    taskById.set(task.id, task);
  }

  if (input.tasks.length === 0) {
    const anchor = dateOnly(input.anchorDate);
    return {
      engine: 'PROJECT_ENGINE_V2',
      anchorDate: anchor,
      ...(input.targetFinish ? { targetFinish: dateOnly(input.targetFinish) } : {}),
      naturalFinishMinutes: 0,
      scheduledProjectFinishMinutes: 0,
      naturalFinish: anchor,
      scheduledProjectFinish: anchor,
      projectDurationWorkingDays: 0,
      criticalTaskIds: [],
      topologicalOrder: [],
      tasks: [],
      violations: [],
      feasible: true,
    };
  }

  const outgoing = new Map<string, ScheduleDependencyV2Input[]>();
  const indegree = new Map<string, number>();
  for (const task of input.tasks) {
    outgoing.set(task.id, []);
    indegree.set(task.id, 0);
  }

  for (const dependency of input.dependencies) {
    if (!taskById.has(dependency.predecessorId)) {
      throw new ScheduleEngineV2ValidationError(`Unknown predecessor: ${dependency.predecessorId}`);
    }
    if (!taskById.has(dependency.successorId)) {
      throw new ScheduleEngineV2ValidationError(`Unknown successor: ${dependency.successorId}`);
    }
    if (dependency.predecessorId === dependency.successorId) {
      throw new ScheduleEngineV2ValidationError('A task cannot depend on itself.');
    }
    if (!Number.isFinite(dependency.lagMinutes)) {
      throw new ScheduleEngineV2ValidationError('Dependency lagMinutes must be finite.');
    }
    outgoing.get(dependency.predecessorId)!.push(dependency);
    indegree.set(dependency.successorId, (indegree.get(dependency.successorId) ?? 0) + 1);
  }

  const queue = input.tasks
    .filter((task) => (indegree.get(task.id) ?? 0) === 0)
    .map((task) => task.id)
    .sort();
  const topologicalOrder: string[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    topologicalOrder.push(id);
    for (const dependency of outgoing.get(id) ?? []) {
      const next = (indegree.get(dependency.successorId) ?? 0) - 1;
      indegree.set(dependency.successorId, next);
      if (next === 0) {
        queue.push(dependency.successorId);
        queue.sort();
      }
    }
  }

  if (topologicalOrder.length !== input.tasks.length) {
    const cycleNodeIds = input.tasks
      .map((task) => task.id)
      .filter((id) => (indegree.get(id) ?? 0) > 0)
      .sort();
    throw new ScheduleEngineV2CycleError(cycleNodeIds);
  }

  const bounds = new Map<string, ConstraintBounds>();
  const earlyStart = new Map<string, number>();
  for (const task of input.tasks) {
    const taskBounds = constraintBounds(task, input.anchorDate, input.calendar);
    bounds.set(task.id, taskBounds);
    earlyStart.set(task.id, Math.max(0, taskBounds.lower ?? 0));
  }

  for (const predecessorId of topologicalOrder) {
    const predecessor = taskById.get(predecessorId)!;
    const predecessorStart = earlyStart.get(predecessorId) ?? 0;
    for (const dependency of outgoing.get(predecessorId) ?? []) {
      const successor = taskById.get(dependency.successorId)!;
      const candidate = predecessorStart + dependencyWeight(
        dependency,
        predecessor.durationMinutes,
        successor.durationMinutes,
      );
      const lower = bounds.get(successor.id)?.lower ?? 0;
      earlyStart.set(successor.id, Math.max(0, lower, earlyStart.get(successor.id) ?? 0, candidate));
    }
  }

  const naturalFinishMinutes = Math.max(
    0,
    ...input.tasks.map((task) => (earlyStart.get(task.id) ?? 0) + task.durationMinutes),
  );

  const targetFinishOffset = input.targetFinish
    ? finishBoundaryOffset(input.anchorDate, input.targetFinish, input.calendar)
    : undefined;
  const scheduledProjectFinishMinutes = targetFinishOffset === undefined
    ? naturalFinishMinutes
    : Math.max(naturalFinishMinutes, targetFinishOffset);

  const lateStart = new Map<string, number>();
  for (const task of input.tasks) {
    let initial = scheduledProjectFinishMinutes - task.durationMinutes;
    const upper = bounds.get(task.id)?.upper;
    if (upper !== undefined) initial = Math.min(initial, upper);
    lateStart.set(task.id, initial);
  }

  for (const predecessorId of [...topologicalOrder].reverse()) {
    const predecessor = taskById.get(predecessorId)!;
    let current = lateStart.get(predecessorId) ?? (scheduledProjectFinishMinutes - predecessor.durationMinutes);
    for (const dependency of outgoing.get(predecessorId) ?? []) {
      const successor = taskById.get(dependency.successorId)!;
      const successorLateStart = lateStart.get(successor.id) ?? 0;
      const candidate = successorLateStart - dependencyWeight(
        dependency,
        predecessor.durationMinutes,
        successor.durationMinutes,
      );
      current = Math.min(current, candidate);
    }
    const upper = bounds.get(predecessorId)?.upper;
    if (upper !== undefined) current = Math.min(current, upper);
    lateStart.set(predecessorId, current);
  }

  const violations: ScheduleViolationV2[] = [];
  if (targetFinishOffset !== undefined && naturalFinishMinutes > targetFinishOffset) {
    violations.push({
      type: 'PROJECT_TARGET_MISSED',
      targetFinishOffsetMinutes: targetFinishOffset,
      naturalFinishOffsetMinutes: naturalFinishMinutes,
    });
  }

  for (const task of input.tasks) {
    const es = earlyStart.get(task.id) ?? 0;
    const taskBounds = bounds.get(task.id) ?? {};
    if (taskBounds.upper !== undefined && es > taskBounds.upper) {
      violations.push({
        type: 'CONSTRAINT_MISSED',
        taskId: task.id,
        constraintType: task.constraintType,
        requiredStartOffsetMinutes: taskBounds.upper,
        calculatedStartOffsetMinutes: es,
      });
    }
    if (task.schedulingMode === 'MANUAL' && [
      'AS_SOON_AS_POSSIBLE',
      'AS_LATE_AS_POSSIBLE',
    ].includes(task.constraintType)) {
      violations.push({ type: 'MANUAL_WITHOUT_DATE_CONSTRAINT', taskId: task.id });
    }
  }

  const results = input.tasks.map((task): ScheduleTaskV2Result => {
    const es = earlyStart.get(task.id) ?? 0;
    const ef = es + task.durationMinutes;
    const ls = lateStart.get(task.id) ?? es;
    const lf = ls + task.durationMinutes;
    const totalFloatMinutes = ls - es;

    const outgoingDependencies = outgoing.get(task.id) ?? [];
    const freeFloatMinutes = outgoingDependencies.length === 0
      ? scheduledProjectFinishMinutes - ef
      : Math.min(
          ...outgoingDependencies.map((dependency) => {
            const successor = taskById.get(dependency.successorId)!;
            const requiredSuccessorStart = es + dependencyWeight(
              dependency,
              task.durationMinutes,
              successor.durationMinutes,
            );
            return (earlyStart.get(successor.id) ?? 0) - requiredSuccessorStart;
          }),
        );

    if (totalFloatMinutes < 0) {
      violations.push({ type: 'NEGATIVE_FLOAT', taskId: task.id, totalFloatMinutes });
    }

    const scheduledStartMinutes = task.constraintType === 'AS_LATE_AS_POSSIBLE'
      ? ls
      : es;
    const scheduledFinishMinutes = scheduledStartMinutes + task.durationMinutes;
    const plannedStartDate = dateAtWorkingMinuteOffsetV2(
      input.anchorDate,
      scheduledStartMinutes,
      input.calendar,
    );
    const plannedFinishDate = finishDateForWorkV2(
      input.anchorDate,
      scheduledStartMinutes,
      task.durationMinutes,
      input.calendar,
    );

    return {
      id: task.id,
      ...(task.title ? { title: task.title } : {}),
      durationMinutes: task.durationMinutes,
      earlyStartMinutes: es,
      earlyFinishMinutes: ef,
      lateStartMinutes: ls,
      lateFinishMinutes: lf,
      totalFloatMinutes,
      freeFloatMinutes,
      critical: totalFloatMinutes === 0,
      scheduledStartMinutes,
      scheduledFinishMinutes,
      plannedStart: dateOnly(plannedStartDate),
      plannedFinish: dateOnly(plannedFinishDate),
      durationWorkingDays: workingDaysEquivalentV2(task.durationMinutes, input.calendar),
      totalFloatWorkingDays: workingDaysEquivalentV2(totalFloatMinutes, input.calendar),
      freeFloatWorkingDays: workingDaysEquivalentV2(freeFloatMinutes, input.calendar),
      constraintType: task.constraintType,
      ...(task.constraintDate ? { constraintDate: dateOnly(task.constraintDate) } : {}),
      schedulingMode: task.schedulingMode,
    };
  });

  const naturalFinishDate = finishDateForWorkV2(
    input.anchorDate,
    0,
    naturalFinishMinutes,
    input.calendar,
  );
  const scheduledFinishDate = finishDateForWorkV2(
    input.anchorDate,
    0,
    scheduledProjectFinishMinutes,
    input.calendar,
  );

  return {
    engine: 'PROJECT_ENGINE_V2',
    anchorDate: dateOnly(input.anchorDate),
    ...(input.targetFinish ? { targetFinish: dateOnly(input.targetFinish) } : {}),
    naturalFinishMinutes,
    scheduledProjectFinishMinutes,
    naturalFinish: dateOnly(naturalFinishDate),
    scheduledProjectFinish: dateOnly(scheduledFinishDate),
    projectDurationWorkingDays: workingDaysEquivalentV2(naturalFinishMinutes, input.calendar),
    criticalTaskIds: results.filter((task) => task.critical).map((task) => task.id),
    topologicalOrder,
    tasks: results,
    violations,
    feasible: !violations.some((violation) => violation.type !== 'MANUAL_WITHOUT_DATE_CONSTRAINT'),
  };
}
