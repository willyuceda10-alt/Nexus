import type { NexusObject, ObjectRelation, ObjectStatus, Priority } from '../types/nexus';

export type MyWorkBucket = 'OVERDUE' | 'TODAY' | 'NEXT_7_DAYS' | 'LATER' | 'UNSCHEDULED';

export interface MyWorkItem {
  objectId: string;
  title: string;
  type: NexusObject['type'];
  status: ObjectStatus;
  priority: Priority;
  progress: number;
  projectId?: string;
  projectTitle?: string;
  startDate?: string;
  endDate?: string;
  effortHours?: number;
  bucket: MyWorkBucket;
  daysUntilDue: number | null;
  blocked: boolean;
  blockerIds: string[];
  blockerTitles: string[];
}

export interface MyWorkProjection {
  items: MyWorkItem[];
  ownedProjects: NexusObject[];
  summary: {
    total: number;
    overdue: number;
    today: number;
    next7Days: number;
    blocked: number;
    unscheduled: number;
    unsized: number;
    effortDueSoonHours: number;
    capacityHoursPerDay: number | null;
  };
  buckets: Record<MyWorkBucket, MyWorkItem[]>;
}

const WORK_TYPES = new Set<NexusObject['type']>(['TASK', 'DELIVERABLE', 'MILESTONE']);
const TERMINAL_STATUSES = new Set<ObjectStatus>(['COMPLETED', 'CANCELLED', 'CLOSED']);
const PRIORITY_RANK: Record<Priority, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};
const BUCKET_RANK: Record<MyWorkBucket, number> = {
  OVERDUE: 0,
  TODAY: 1,
  NEXT_7_DAYS: 2,
  LATER: 3,
  UNSCHEDULED: 4,
};
const DAY_MS = 86_400_000;

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

function utcDayMs(value: string): number {
  return Date.parse(`${dateOnly(value)}T00:00:00.000Z`);
}

function daysBetween(from: string, to: string): number {
  return Math.round((utcDayMs(to) - utcDayMs(from)) / DAY_MS);
}

function bucketFor(endDate: string | undefined, today: string): { bucket: MyWorkBucket; daysUntilDue: number | null } {
  if (!endDate) return { bucket: 'UNSCHEDULED', daysUntilDue: null };
  const daysUntilDue = daysBetween(today, endDate);
  if (daysUntilDue < 0) return { bucket: 'OVERDUE', daysUntilDue };
  if (daysUntilDue === 0) return { bucket: 'TODAY', daysUntilDue };
  if (daysUntilDue <= 7) return { bucket: 'NEXT_7_DAYS', daysUntilDue };
  return { bucket: 'LATER', daysUntilDue };
}

export function isOpenPersonalWork(object: NexusObject, userId: string): boolean {
  if (!WORK_TYPES.has(object.type) || TERMINAL_STATUSES.has(object.status)) return false;
  if (object.assigneeId) return object.assigneeId === userId;
  return object.ownerId === userId;
}

function compareItems(a: MyWorkItem, b: MyWorkItem): number {
  const bucketDifference = BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket];
  if (bucketDifference !== 0) return bucketDifference;

  if (a.blocked !== b.blocked) return a.blocked ? -1 : 1;

  const priorityDifference = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
  if (priorityDifference !== 0) return priorityDifference;

  if (a.endDate && b.endDate) return a.endDate.localeCompare(b.endDate);
  if (a.endDate) return -1;
  if (b.endDate) return 1;
  return a.title.localeCompare(b.title, 'es');
}

export function buildMyWorkProjection(
  objects: NexusObject[],
  dependencies: ObjectRelation[],
  userId: string,
  today: string,
): MyWorkProjection {
  const objectById = new Map(objects.map((object) => [object.id, object]));
  const projectById = new Map(
    objects.filter((object) => object.type === 'PROJECT').map((project) => [project.id, project]),
  );

  const predecessorIdsBySuccessor = new Map<string, string[]>();
  for (const relation of dependencies) {
    if (relation.relationType !== 'DEPENDS_ON') continue;
    const predecessorIds = predecessorIdsBySuccessor.get(relation.sourceObjectId) ?? [];
    predecessorIds.push(relation.targetObjectId);
    predecessorIdsBySuccessor.set(relation.sourceObjectId, predecessorIds);
  }

  const items = objects
    .filter((object) => isOpenPersonalWork(object, userId))
    .map<MyWorkItem>((object) => {
      const predecessorIds = predecessorIdsBySuccessor.get(object.id) ?? [];
      const openBlockers = predecessorIds
        .map((id) => objectById.get(id))
        .filter((candidate): candidate is NexusObject => Boolean(candidate) && !TERMINAL_STATUSES.has(candidate!.status));
      const due = bucketFor(object.endDate, today);
      const project = object.projectId ? projectById.get(object.projectId) : undefined;

      return {
        objectId: object.id,
        title: object.title,
        type: object.type,
        status: object.status,
        priority: object.priority,
        progress: object.progress,
        ...(object.projectId ? { projectId: object.projectId } : {}),
        ...(project ? { projectTitle: project.title } : {}),
        ...(object.startDate ? { startDate: object.startDate } : {}),
        ...(object.endDate ? { endDate: object.endDate } : {}),
        ...(object.effortHours !== undefined ? { effortHours: object.effortHours } : {}),
        ...due,
        blocked: openBlockers.length > 0,
        blockerIds: openBlockers.map((blocker) => blocker.id),
        blockerTitles: openBlockers.map((blocker) => blocker.title),
      };
    })
    .sort(compareItems);

  const buckets: Record<MyWorkBucket, MyWorkItem[]> = {
    OVERDUE: [],
    TODAY: [],
    NEXT_7_DAYS: [],
    LATER: [],
    UNSCHEDULED: [],
  };
  for (const item of items) buckets[item.bucket].push(item);

  const resourceProfile = objects.find(
    (object) => object.type === 'RESOURCE' && object.linkedUserId === userId,
  );
  const dueSoon = items.filter((item) => item.bucket === 'TODAY' || item.bucket === 'NEXT_7_DAYS');

  return {
    items,
    ownedProjects: objects
      .filter(
        (object) =>
          object.type === 'PROJECT' &&
          object.ownerId === userId &&
          !TERMINAL_STATUSES.has(object.status),
      )
      .sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]),
    summary: {
      total: items.length,
      overdue: buckets.OVERDUE.length,
      today: buckets.TODAY.length,
      next7Days: buckets.NEXT_7_DAYS.length,
      blocked: items.filter((item) => item.blocked).length,
      unscheduled: buckets.UNSCHEDULED.length,
      unsized: items.filter((item) => item.effortHours === undefined).length,
      effortDueSoonHours: dueSoon.reduce((sum, item) => sum + (item.effortHours ?? 0), 0),
      capacityHoursPerDay: resourceProfile?.capacityHoursPerDay ?? null,
    },
    buckets,
  };
}
