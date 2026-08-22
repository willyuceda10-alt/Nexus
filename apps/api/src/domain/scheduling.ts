export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';

export interface ScheduleTask {
  id: string;
  durationDays: number;
}

export interface ScheduleDependency {
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  lagDays?: number;
}

export interface ScheduleTaskResult {
  id: string;
  durationDays: number;
  earlyStart: number;
  earlyFinish: number;
  lateStart: number;
  lateFinish: number;
  totalFloat: number;
  freeFloat: number;
  critical: boolean;
}

export interface ScheduleAnalysis {
  projectDurationDays: number;
  criticalTaskIds: string[];
  topologicalOrder: string[];
  tasks: ScheduleTaskResult[];
}

export class ScheduleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleValidationError';
  }
}

export class ScheduleCycleError extends Error {
  readonly cycleNodeIds: string[];

  constructor(cycleNodeIds: string[]) {
    super(`Dependency graph contains a cycle involving: ${cycleNodeIds.join(', ')}`);
    this.name = 'ScheduleCycleError';
    this.cycleNodeIds = cycleNodeIds;
  }
}

function dependencyWeight(
  dependency: ScheduleDependency,
  predecessorDuration: number,
  successorDuration: number,
): number {
  const lag = dependency.lagDays ?? 0;
  switch (dependency.type) {
    case 'FS':
      return predecessorDuration + lag;
    case 'SS':
      return lag;
    case 'FF':
      return predecessorDuration + lag - successorDuration;
    case 'SF':
      return lag - successorDuration;
  }
}

export function calculateCpm(
  tasks: ScheduleTask[],
  dependencies: ScheduleDependency[],
): ScheduleAnalysis {
  const taskById = new Map<string, ScheduleTask>();
  for (const task of tasks) {
    if (taskById.has(task.id)) {
      throw new ScheduleValidationError(`Duplicate task id: ${task.id}`);
    }
    if (!Number.isFinite(task.durationDays) || task.durationDays < 0) {
      throw new ScheduleValidationError(`Task ${task.id} has an invalid duration.`);
    }
    taskById.set(task.id, { ...task, durationDays: Math.max(0, task.durationDays) });
  }

  if (tasks.length === 0) {
    return {
      projectDurationDays: 0,
      criticalTaskIds: [],
      topologicalOrder: [],
      tasks: [],
    };
  }

  const outgoing = new Map<string, ScheduleDependency[]>();
  const indegree = new Map<string, number>();
  for (const task of tasks) {
    outgoing.set(task.id, []);
    indegree.set(task.id, 0);
  }

  for (const dependency of dependencies) {
    if (!taskById.has(dependency.predecessorId)) {
      throw new ScheduleValidationError(`Unknown predecessor: ${dependency.predecessorId}`);
    }
    if (!taskById.has(dependency.successorId)) {
      throw new ScheduleValidationError(`Unknown successor: ${dependency.successorId}`);
    }
    if (dependency.predecessorId === dependency.successorId) {
      throw new ScheduleValidationError('A task cannot depend on itself.');
    }
    if (!Number.isFinite(dependency.lagDays ?? 0)) {
      throw new ScheduleValidationError('Dependency lag must be a finite number.');
    }

    outgoing.get(dependency.predecessorId)!.push(dependency);
    indegree.set(dependency.successorId, (indegree.get(dependency.successorId) ?? 0) + 1);
  }

  const queue = [...tasks]
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

  if (topologicalOrder.length !== tasks.length) {
    const cycleNodeIds = tasks
      .map((task) => task.id)
      .filter((id) => (indegree.get(id) ?? 0) > 0)
      .sort();
    throw new ScheduleCycleError(cycleNodeIds);
  }

  const earlyStart = new Map<string, number>(tasks.map((task) => [task.id, 0]));

  for (const predecessorId of topologicalOrder) {
    const predecessor = taskById.get(predecessorId)!;
    const predecessorStart = earlyStart.get(predecessorId) ?? 0;
    for (const dependency of outgoing.get(predecessorId) ?? []) {
      const successor = taskById.get(dependency.successorId)!;
      const weight = dependencyWeight(
        dependency,
        predecessor.durationDays,
        successor.durationDays,
      );
      const candidate = predecessorStart + weight;
      earlyStart.set(
        dependency.successorId,
        Math.max(0, earlyStart.get(dependency.successorId) ?? 0, candidate),
      );
    }
  }

  const projectDurationDays = Math.max(
    ...tasks.map((task) => (earlyStart.get(task.id) ?? 0) + task.durationDays),
  );

  const lateStart = new Map<string, number>(
    tasks.map((task) => [task.id, projectDurationDays - task.durationDays]),
  );

  for (const predecessorId of [...topologicalOrder].reverse()) {
    const predecessor = taskById.get(predecessorId)!;
    for (const dependency of outgoing.get(predecessorId) ?? []) {
      const successor = taskById.get(dependency.successorId)!;
      const weight = dependencyWeight(
        dependency,
        predecessor.durationDays,
        successor.durationDays,
      );
      const candidate = (lateStart.get(dependency.successorId) ?? 0) - weight;
      lateStart.set(
        predecessorId,
        Math.min(lateStart.get(predecessorId) ?? candidate, candidate),
      );
    }
  }

  const results: ScheduleTaskResult[] = tasks.map((task) => {
    const es = earlyStart.get(task.id) ?? 0;
    const ef = es + task.durationDays;
    const ls = lateStart.get(task.id) ?? es;
    const lf = ls + task.durationDays;
    const totalFloat = Math.max(0, ls - es);

    const outgoingDependencies = outgoing.get(task.id) ?? [];
    const freeFloat = outgoingDependencies.length === 0
      ? Math.max(0, projectDurationDays - ef)
      : Math.max(
          0,
          Math.min(
            ...outgoingDependencies.map((dependency) => {
              const successor = taskById.get(dependency.successorId)!;
              const weight = dependencyWeight(
                dependency,
                task.durationDays,
                successor.durationDays,
              );
              return (earlyStart.get(dependency.successorId) ?? 0) - (es + weight);
            }),
          ),
        );

    return {
      id: task.id,
      durationDays: task.durationDays,
      earlyStart: es,
      earlyFinish: ef,
      lateStart: ls,
      lateFinish: lf,
      totalFloat,
      freeFloat,
      critical: totalFloat === 0,
    };
  });

  return {
    projectDurationDays,
    criticalTaskIds: results.filter((task) => task.critical).map((task) => task.id),
    topologicalOrder,
    tasks: results,
  };
}
