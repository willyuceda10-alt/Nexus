import assert from 'node:assert/strict';
import { buildMeetingsDecisionsProjection } from './meetingsDecisions';
import type { NexusObject, ObjectRelation } from '../types/nexus';

const base = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  description: '',
  ownerId: 'user-1',
  ownerName: 'Owner',
  ownerAvatar: '',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
  progress: 0,
} as const;

const objects: NexusObject[] = [
  {
    ...base,
    id: 'project-1',
    type: 'PROJECT',
    title: 'Project Alpha',
    status: 'IN_PROGRESS',
    priority: 'HIGH',
  },
  {
    ...base,
    id: 'meeting-today',
    type: 'MEETING',
    projectId: 'project-1',
    title: 'Daily governance',
    status: 'IN_PROGRESS',
    priority: 'MEDIUM',
    meetingDate: '2026-08-26T15:00:00.000Z',
    meetingAgenda: 'Review risks',
    participants: ['Owner', 'PM'],
  },
  {
    ...base,
    id: 'meeting-future',
    type: 'MEETING',
    projectId: 'project-1',
    title: 'Steering committee',
    status: 'PLANNING',
    priority: 'HIGH',
    meetingDate: '2026-08-29T15:00:00.000Z',
  },
  {
    ...base,
    id: 'meeting-completed',
    type: 'MEETING',
    projectId: 'project-1',
    title: 'Previous committee',
    status: 'COMPLETED',
    priority: 'MEDIUM',
    meetingDate: '2026-08-20T15:00:00.000Z',
    meetingAgenda: 'Previous agenda',
  },
  {
    ...base,
    id: 'decision-linked',
    type: 'DECISION',
    projectId: 'project-1',
    meetingId: 'meeting-today',
    title: 'Approve scope',
    status: 'APPROVED',
    priority: 'HIGH',
    decisionJustification: 'Business case approved',
  },
  {
    ...base,
    id: 'decision-relation',
    type: 'DECISION',
    projectId: 'project-1',
    title: 'Escalate vendor issue',
    status: 'PENDING_APPROVAL',
    priority: 'HIGH',
  },
  {
    ...base,
    id: 'decision-orphan',
    type: 'DECISION',
    projectId: 'project-1',
    title: 'Orphan decision',
    status: 'DRAFT',
    priority: 'LOW',
  },
  {
    ...base,
    id: 'task-action',
    type: 'TASK',
    projectId: 'project-1',
    title: 'Derived action',
    status: 'IN_PROGRESS',
    priority: 'HIGH',
  },
];

const relations: ObjectRelation[] = [
  {
    id: 'rel-meeting-decision',
    sourceObjectId: 'meeting-future',
    targetObjectId: 'decision-relation',
    relationType: 'DERIVED_FROM',
  },
  {
    id: 'rel-meeting-task',
    sourceObjectId: 'meeting-today',
    targetObjectId: 'task-action',
    relationType: 'DERIVED_FROM',
  },
  {
    id: 'rel-decision-task',
    sourceObjectId: 'decision-linked',
    targetObjectId: 'task-action',
    relationType: 'RELATES_TO',
  },
];

const result = buildMeetingsDecisionsProjection(objects, relations, '2026-08-26T12:00:00.000Z');

assert.equal(result.summary.todayMeetingCount, 1);
assert.equal(result.summary.upcomingMeetingCount, 1);
assert.equal(result.summary.unscheduledMeetingCount, 0);
assert.equal(result.summary.meetingsWithoutAgendaCount, 1);
assert.equal(result.summary.completedWithoutMinutesCount, 1);
assert.equal(result.summary.pendingDecisionCount, 2);
assert.equal(result.summary.approvedDecisionCount, 1);
assert.equal(result.summary.orphanDecisionCount, 1);
assert.equal(result.summary.derivedActionCount, 1);

const today = result.meetings.find((meeting) => meeting.id === 'meeting-today');
assert.ok(today);
assert.equal(today.timing, 'TODAY');
assert.equal(today.hasAgenda, true);
assert.equal(today.hasMinutes, false);
assert.deepEqual(today.participants, ['Owner', 'PM']);
assert.deepEqual(today.decisionIds, ['decision-linked']);
assert.deepEqual(today.actionIds, ['task-action']);

const relationDecision = result.decisions.find((decision) => decision.id === 'decision-relation');
assert.ok(relationDecision);
assert.equal(relationDecision.meetingId, 'meeting-future');
assert.equal(relationDecision.meetingTitle, 'Steering committee');

const orphan = result.decisions.find((decision) => decision.id === 'decision-orphan');
assert.ok(orphan);
assert.equal(orphan.meetingId, undefined);

const scoped = buildMeetingsDecisionsProjection(objects, relations, '2026-08-26T12:00:00.000Z', 'project-1');
assert.equal(scoped.meetings.length, 3);
assert.equal(scoped.decisions.length, 3);

console.info('Meetings & Decisions V2 projection smoke: PASS');
