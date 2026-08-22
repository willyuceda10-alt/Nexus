import type { ApiDependencyType, ApiScheduleAnalysis } from '../api/contracts';
import type { NexusObject, ObjectRelation } from '../types/nexus';

const DAY_MS = 86_400_000;

interface LocalTask {
  object: NexusObject;
  durationDays: number;
}

interface LocalDependency {
  id: string;
  predecessorId: string;
  successorId: string;
  type: ApiDependencyType;
  lagDays: number;
}

function dateOnly(value?: string): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function durationDays(object: NexusObject): number | null {
  const start = dateOnly(object.startDate) ?? dateOnly(object.endDate);
  const endCandidate = dateOnly(object.endDate) ?? start;
  if (!start || !endCandidate) return null;
  if (object.type === 'MILESTONE') return 0;
  const end = endCandidate.getTime() < start.getTime() ? start : endCandidate;
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1);
}

function dependencyWeight(
  dependency: LocalDependency,
  predecessorDuration: number,
  successorDuration: number,
): number {
  switch (dependency.type) {
    case 'FS': return predecessorDuration + dependency.lagDays;
    case 'SS': return dependency.lagDays;
    case 'FF': return predecessorDuration + dependency.lagDays - successorDuration;
    case 'SF': return dependency.lagDays - successorDuration;
  }
}

export function calculateLocalSchedule(
  projectId: string,
  workspaceId: string,
  objects: NexusObject[],
  relations: ObjectRelation[],
): ApiScheduleAnalysis {
  const projectObjects = objects.filter(
    (object) =>
      object.projectId === projectId &&
      ['TASK', 'DELIVERABLE', 'MILESTONE'].includes(object.type),
  );

  const scheduled: LocalTask[] = projectObjects
    .map((object) => ({ object, durationDays: durationDays(object) }))
    .filter((entry): entry is { object: NexusObject; durationDays: number } => entry.durationDays !== null);
  const taskById = new Map(scheduled.map((entry) => [entry.object.id, entry]));

  const dependencies: LocalDependency[] = relations
    .filter(
      (relation) =>
        relation.relationType === 'DEPENDS_ON' &&
        taskById.has(relation.sourceObjectId) &&
        taskById.has(relation.targetObjectId),
    )
    .map((relation) => ({
      id: relation.id,
      predecessorId: relation.targetObjectId,
      successorId: relation.sourceObjectId,
      type: relation.dependencyType ?? 'FS',
      lagDays: relation.lagDays ?? 0,
    }));

  const outgoing = new Map<string, LocalDependency[]>();
  const indegree = new Map<string, number>();
  for (const task of scheduled) {
    outgoing.set(task.object.id, []);
    indegree.set(task.object.id, 0);
  }
  for (const dependency of dependencies) {
    outgoing.get(dependency.predecessorId)?.push(dependency);
    indegree.set(dependency.successorId, (indegree.get(dependency.successorId) ?? 0) + 1);
  }

  const queue = scheduled
    .filter((task) => (indegree.get(task.object.id) ?? 0) === 0)
    .map((task) => task.object.id)
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

  // The API prevents cycles. In mock preview, fail closed by returning no CPM
  // result rather than inventing a path if old fixture data contains a cycle.
  if (topologicalOrder.length !== scheduled.length) {
    return {
      projectId,
      workspaceId,
      calendar: 'CALENDAR_DAYS_V1',
      projectDurationDays: 0,
      criticalTaskIds: [],
      topologicalOrder: [],
      tasks: [],
      dependencies,
      unscheduledObjectIds: projectObjects.map((object) => object.id),
    };
  }

  const earlyStart = new Map(scheduled.map((task) => [task.object.id, 0]));
  for (const predecessorId of topologicalOrder) {
    const predecessor = taskById.get(predecessorId)!;
    const predecessorStart = earlyStart.get(predecessorId) ?? 0;
    for (const dependency of outgoing.get(predecessorId) ?? []) {
      const successor = taskById.get(dependency.successorId)!;
      const candidate = predecessorStart + dependencyWeight(
        dependency,
        predecessor.durationDays,
        successor.durationDays,
      );
      earlyStart.set(
        dependency.successorId,
        Math.max(0, earlyStart.get(dependency.successorId) ?? 0, candidate),
      );
    }
  }

  const projectDurationDays = scheduled.length
    ? Math.max(...scheduled.map((task) => (earlyStart.get(task.object.id) ?? 0) + task.durationDays))
    : 0;
  const lateStart = new Map(
    scheduled.map((task) => [task.object.id, projectDurationDays - task.durationDays]),
  );

  for (const predecessorId of [...topologicalOrder].reverse()) {
    const predecessor = taskById.get(predecessorId)!;
    for (const dependency of outgoing.get(predecessorId) ?? []) {
      const successor = taskById.get(dependency.successorId)!;
      const candidate = (lateStart.get(dependency.successorId) ?? 0) - dependencyWeight(
        dependency,
        predecessor.durationDays,
        successor.durationDays,
      );
      lateStart.set(
        predecessorId,
        Math.min(lateStart.get(predecessorId) ?? candidate, candidate),
      );
    }
  }

  const tasks = scheduled.map((entry) => {
    const es = earlyStart.get(entry.object.id) ?? 0;
    const ef = es + entry.durationDays;
    const ls = lateStart.get(entry.object.id) ?? es;
    const lf = ls + entry.durationDays;
    const totalFloat = Math.max(0, ls - es);
    const successors = outgoing.get(entry.object.id) ?? [];
    const freeFloat = successors.length === 0
      ? Math.max(0, projectDurationDays - ef)
      : Math.max(
          0,
          Math.min(
            ...successors.map((dependency) => {
              const successor = taskById.get(dependency.successorId)!;
              const weight = dependencyWeight(
                dependency,
                entry.durationDays,
                successor.durationDays,
              );
              return (earlyStart.get(dependency.successorId) ?? 0) - (es + weight);
            }),
          ),
        );

    return {
      id: entry.object.id,
      title: entry.object.title,
      objectTypeKey: entry.object.type,
      durationDays: entry.durationDays,
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
    projectId,
    workspaceId,
    calendar: 'CALENDAR_DAYS_V1',
    projectDurationDays,
    criticalTaskIds: tasks.filter((task) => task.critical).map((task) => task.id),
    topologicalOrder,
    tasks,
    dependencies,
    unscheduledObjectIds: projectObjects
      .filter((object) => !taskById.has(object.id))
      .map((object) => object.id),
  };
}
