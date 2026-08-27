import type { NexusObject, ObjectRelation } from '../types/nexus';

export type MeetingTiming = 'UPCOMING' | 'TODAY' | 'PAST' | 'UNSCHEDULED';

export interface MeetingExecutionRow {
  id: string;
  title: string;
  projectId?: string;
  projectName: string;
  status: NexusObject['status'];
  ownerName: string;
  meetingDate?: string;
  timing: MeetingTiming;
  agenda?: string;
  minutes?: string;
  participants: string[];
  hasAgenda: boolean;
  hasMinutes: boolean;
  decisionIds: string[];
  actionIds: string[];
  source: NexusObject;
}

export interface DecisionExecutionRow {
  id: string;
  title: string;
  projectId?: string;
  projectName: string;
  meetingId?: string;
  meetingTitle?: string;
  status: NexusObject['status'];
  ownerName: string;
  justification?: string;
  authorizerId?: string;
  relatedActionIds: string[];
  source: NexusObject;
}

export interface MeetingsDecisionsProjection {
  meetings: MeetingExecutionRow[];
  decisions: DecisionExecutionRow[];
  summary: {
    upcomingMeetingCount: number;
    todayMeetingCount: number;
    unscheduledMeetingCount: number;
    meetingsWithoutAgendaCount: number;
    completedWithoutMinutesCount: number;
    pendingDecisionCount: number;
    approvedDecisionCount: number;
    orphanDecisionCount: number;
    derivedActionCount: number;
  };
}

const TERMINAL_MEETING_STATUSES = new Set<NexusObject['status']>(['COMPLETED', 'CANCELLED', 'CLOSED']);
const PENDING_DECISION_STATUSES = new Set<NexusObject['status']>(['DRAFT', 'PLANNING', 'IN_PROGRESS', 'IN_REVIEW', 'PENDING_APPROVAL']);
const ACTION_TYPES = new Set<NexusObject['type']>(['TASK', 'DELIVERABLE', 'MILESTONE']);

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

function normalizeMeetingDate(meeting: NexusObject): string | undefined {
  return meeting.meetingDate ?? meeting.startDate;
}

function meetingTiming(meetingDate: string | undefined, today: string): MeetingTiming {
  if (!meetingDate) return 'UNSCHEDULED';
  const day = dateOnly(meetingDate);
  if (day === today) return 'TODAY';
  return day > today ? 'UPCOMING' : 'PAST';
}

function linkedIds(
  objectId: string,
  relations: ObjectRelation[],
  allowedTypes: Set<NexusObject['type']>,
  objectById: Map<string, NexusObject>,
): string[] {
  const ids = new Set<string>();
  for (const relation of relations) {
    let otherId: string | undefined;
    if (relation.sourceObjectId === objectId) otherId = relation.targetObjectId;
    else if (relation.targetObjectId === objectId) otherId = relation.sourceObjectId;
    if (!otherId) continue;
    const other = objectById.get(otherId);
    if (other && allowedTypes.has(other.type)) ids.add(other.id);
  }
  return [...ids];
}

function linkedDecisionIds(
  meetingId: string,
  decisions: NexusObject[],
  relations: ObjectRelation[],
  objectById: Map<string, NexusObject>,
): string[] {
  const ids = new Set<string>();
  for (const decision of decisions) {
    if (decision.meetingId === meetingId) ids.add(decision.id);
  }
  for (const id of linkedIds(meetingId, relations, new Set<NexusObject['type']>(['DECISION']), objectById)) {
    ids.add(id);
  }
  return [...ids];
}

function resolveDecisionMeetingId(
  decision: NexusObject,
  meetings: NexusObject[],
  relations: ObjectRelation[],
  objectById: Map<string, NexusObject>,
): string | undefined {
  if (decision.meetingId && objectById.get(decision.meetingId)?.type === 'MEETING') return decision.meetingId;
  const linked = linkedIds(decision.id, relations, new Set<NexusObject['type']>(['MEETING']), objectById);
  if (linked.length === 1) return linked[0];
  if (decision.projectId) {
    const sameProject = meetings.filter((meeting) => meeting.projectId === decision.projectId && linked.includes(meeting.id));
    if (sameProject.length === 1) return sameProject[0]!.id;
  }
  return undefined;
}

export function buildMeetingsDecisionsProjection(
  objects: NexusObject[],
  relations: ObjectRelation[],
  nowIso: string,
  scopedProjectId?: string,
): MeetingsDecisionsProjection {
  const today = dateOnly(nowIso);
  const objectById = new Map(objects.map((object) => [object.id, object]));
  const projectById = new Map(objects.filter((object) => object.type === 'PROJECT').map((project) => [project.id, project]));

  const meetingObjects = objects.filter(
    (object) => object.type === 'MEETING' && (!scopedProjectId || object.projectId === scopedProjectId),
  );
  const decisionObjects = objects.filter(
    (object) => object.type === 'DECISION' && (!scopedProjectId || object.projectId === scopedProjectId),
  );

  const meetings: MeetingExecutionRow[] = meetingObjects.map((meeting) => {
    const meetingDate = normalizeMeetingDate(meeting);
    const project = meeting.projectId ? projectById.get(meeting.projectId) : undefined;
    return {
      id: meeting.id,
      title: meeting.title,
      ...(meeting.projectId ? { projectId: meeting.projectId } : {}),
      projectName: project?.title ?? 'Sin proyecto',
      status: meeting.status,
      ownerName: meeting.assigneeName ?? meeting.ownerName,
      ...(meetingDate ? { meetingDate } : {}),
      timing: meetingTiming(meetingDate, today),
      ...(meeting.meetingAgenda?.trim() ? { agenda: meeting.meetingAgenda.trim() } : {}),
      ...(meeting.meetingMinutes?.trim() ? { minutes: meeting.meetingMinutes.trim() } : {}),
      participants: meeting.participants ?? [],
      hasAgenda: Boolean(meeting.meetingAgenda?.trim()),
      hasMinutes: Boolean(meeting.meetingMinutes?.trim()),
      decisionIds: linkedDecisionIds(meeting.id, decisionObjects, relations, objectById),
      actionIds: linkedIds(meeting.id, relations, ACTION_TYPES, objectById),
      source: meeting,
    };
  });

  const meetingById = new Map(meetings.map((meeting) => [meeting.id, meeting]));
  const decisions: DecisionExecutionRow[] = decisionObjects.map((decision) => {
    const project = decision.projectId ? projectById.get(decision.projectId) : undefined;
    const meetingId = resolveDecisionMeetingId(decision, meetingObjects, relations, objectById);
    const meeting = meetingId ? meetingById.get(meetingId) : undefined;
    return {
      id: decision.id,
      title: decision.title,
      ...(decision.projectId ? { projectId: decision.projectId } : {}),
      projectName: project?.title ?? 'Sin proyecto',
      ...(meetingId ? { meetingId } : {}),
      ...(meeting?.title ? { meetingTitle: meeting.title } : {}),
      status: decision.status,
      ownerName: decision.assigneeName ?? decision.ownerName,
      ...(decision.decisionJustification?.trim() ? { justification: decision.decisionJustification.trim() } : {}),
      ...(decision.decisionAuthorizerId ? { authorizerId: decision.decisionAuthorizerId } : {}),
      relatedActionIds: linkedIds(decision.id, relations, ACTION_TYPES, objectById),
      source: decision,
    };
  });

  const sortedMeetings = [...meetings].sort((a, b) => {
    const rank = (value: MeetingTiming) => value === 'TODAY' ? 0 : value === 'UPCOMING' ? 1 : value === 'UNSCHEDULED' ? 2 : 3;
    const rankDiff = rank(a.timing) - rank(b.timing);
    if (rankDiff !== 0) return rankDiff;
    if (a.meetingDate && b.meetingDate) return a.meetingDate.localeCompare(b.meetingDate);
    if (a.meetingDate) return -1;
    if (b.meetingDate) return 1;
    return a.title.localeCompare(b.title);
  });

  const sortedDecisions = [...decisions].sort((a, b) => {
    const aPending = PENDING_DECISION_STATUSES.has(a.status) ? 0 : 1;
    const bPending = PENDING_DECISION_STATUSES.has(b.status) ? 0 : 1;
    return aPending - bPending || b.source.updatedAt.localeCompare(a.source.updatedAt);
  });

  const uniqueActionIds = new Set<string>();
  for (const meeting of meetings) for (const id of meeting.actionIds) uniqueActionIds.add(id);
  for (const decision of decisions) for (const id of decision.relatedActionIds) uniqueActionIds.add(id);

  return {
    meetings: sortedMeetings,
    decisions: sortedDecisions,
    summary: {
      upcomingMeetingCount: meetings.filter((meeting) => meeting.timing === 'UPCOMING').length,
      todayMeetingCount: meetings.filter((meeting) => meeting.timing === 'TODAY').length,
      unscheduledMeetingCount: meetings.filter((meeting) => meeting.timing === 'UNSCHEDULED').length,
      meetingsWithoutAgendaCount: meetings.filter((meeting) => !meeting.hasAgenda && !TERMINAL_MEETING_STATUSES.has(meeting.status)).length,
      completedWithoutMinutesCount: meetings.filter((meeting) => TERMINAL_MEETING_STATUSES.has(meeting.status) && !meeting.hasMinutes).length,
      pendingDecisionCount: decisions.filter((decision) => PENDING_DECISION_STATUSES.has(decision.status)).length,
      approvedDecisionCount: decisions.filter((decision) => decision.status === 'APPROVED').length,
      orphanDecisionCount: decisions.filter((decision) => !decision.meetingId).length,
      derivedActionCount: uniqueActionIds.size,
    },
  };
}
