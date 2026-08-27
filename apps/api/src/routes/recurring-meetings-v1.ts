import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canAccessWorkspace } from '../authorization.js';
import { config } from '../config.js';
import { expandMeetingRecurrenceV1, type MeetingRecurrenceRuleV1 } from '../domain/meeting-recurrence-v1.js';
import {
  MicrosoftGraphAvailabilityClient,
  MicrosoftGraphAvailabilityConfigurationError,
  MicrosoftGraphAvailabilityError,
} from '../microsoft-graph-availability-client.js';
import { withTenant } from '../tenant-transaction.js';

const uuid = z.string().uuid();
const day = z.enum(['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']);
const recurrenceSchema = z.object({
  patternType: z.enum(['DAILY', 'WEEKLY', 'ABSOLUTE_MONTHLY']),
  interval: z.number().int().min(1).max(99),
  daysOfWeek: z.array(day).max(7).default([]),
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  rangeType: z.enum(['NUMBERED', 'END_DATE']),
  numberOfOccurrences: z.number().int().min(2).max(120).nullable().optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  timezone: z.literal('America/Lima').default('America/Lima'),
}).superRefine((value, ctx) => {
  if (value.patternType === 'WEEKLY' && value.daysOfWeek.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['daysOfWeek'], message: 'WEEKLY recurrence requires daysOfWeek.' });
  }
  if (value.patternType !== 'WEEKLY' && value.daysOfWeek.length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['daysOfWeek'], message: 'daysOfWeek is only valid for WEEKLY recurrence.' });
  }
  if (value.patternType === 'ABSOLUTE_MONTHLY' && value.dayOfMonth == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dayOfMonth'], message: 'ABSOLUTE_MONTHLY recurrence requires dayOfMonth.' });
  }
  if (value.patternType !== 'ABSOLUTE_MONTHLY' && value.dayOfMonth != null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dayOfMonth'], message: 'dayOfMonth is only valid for ABSOLUTE_MONTHLY recurrence.' });
  }
  if (value.rangeType === 'NUMBERED' && (value.numberOfOccurrences == null || value.endDate != null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['numberOfOccurrences'], message: 'NUMBERED recurrence requires numberOfOccurrences and no endDate.' });
  }
  if (value.rangeType === 'END_DATE' && (value.endDate == null || value.numberOfOccurrences != null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'END_DATE recurrence requires endDate and no numberOfOccurrences.' });
  }
});
const externalAttendee = z.object({
  email: z.string().trim().email().max(320),
  displayName: z.string().trim().min(1).max(255),
  attendeeType: z.enum(['REQUIRED', 'OPTIONAL']).default('REQUIRED'),
});
const createSchema = z.object({
  workspaceId: uuid,
  projectId: uuid.nullable().optional(),
  title: z.string().trim().min(1).max(500),
  description: z.string().max(20000).nullable().optional(),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  location: z.string().trim().max(500).nullable().optional(),
  isOnline: z.boolean().default(true),
  attendeeUserIds: z.array(uuid).max(100).default([]),
  externalAttendees: z.array(externalAttendee).max(50).default([]),
  resourceIds: z.array(uuid).max(20).default([]),
  requestM365Sync: z.boolean().default(true),
  recurrence: recurrenceSchema,
}).superRefine((value, ctx) => {
  if (value.endAt <= value.startAt) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endAt'], message: 'endAt must be after startAt.' });
  if (value.endAt.getTime() - value.startAt.getTime() > 8 * 60 * 60 * 1000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endAt'], message: 'Recurring Meetings V1 limits each occurrence to 8 hours.' });
  }
});
const listQuery = z.object({ workspaceId: uuid, projectId: uuid.optional() });

type ResolvedPerson = { userId: string; email: string; displayName: string };
type ResolvedResource = { id: string; resourceType: 'ROOM' | 'EQUIPMENT'; name: string; email: string; capacity: number | null; location: string | null };

function dedupeAttendees(values: Array<{ userId: string | null; email: string; displayName: string; attendeeType: 'REQUIRED' | 'OPTIONAL' }>) {
  const map = new Map<string, (typeof values)[number]>();
  for (const value of values) map.set(value.email.trim().toLowerCase(), { ...value, email: value.email.trim().toLowerCase() });
  return [...map.values()];
}
function scheduleFree(view: string): boolean { return view.length > 0 && [...view].every((value) => value === '0'); }
function dateOnly(value: Date): string { return value.toISOString().slice(0, 10); }

export async function recurringMeetingsV1Routes(app: FastifyInstance): Promise<void> {
  const graph = new MicrosoftGraphAvailabilityClient();
  app.addHook('onClose', async () => graph.close());

  app.post('/api/v1/meetings-v3/recurring', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() });
    const actor = request.actor!;
    let occurrences;
    try {
      occurrences = expandMeetingRecurrenceV1(parsed.data.startAt, parsed.data.endAt, parsed.data.recurrence as MeetingRecurrenceRuleV1);
    } catch (error) {
      return reply.code(400).send({ error: 'invalid_recurrence', message: error instanceof Error ? error.message : String(error) });
    }

    const resolved = await withTenant(actor.tenantId, async (tx) => {
      if (!(await canAccessWorkspace(tx, actor, parsed.data.workspaceId))) return { kind: 'forbidden' as const };
      const definition = await tx.objectDefinition.findFirst({ where: { tenantId: actor.tenantId, key: 'MEETING' }, select: { id: true } });
      if (!definition) return { kind: 'definition-missing' as const };
      if (parsed.data.projectId) {
        const project = await tx.nexusObject.findFirst({ where: { id: parsed.data.projectId, tenantId: actor.tenantId, workspaceId: parsed.data.workspaceId, objectTypeKey: 'PROJECT', deletedAt: null }, select: { id: true } });
        if (!project) return { kind: 'project-invalid' as const };
      }
      const userIds = [...new Set(parsed.data.attendeeUserIds)];
      const members = userIds.length ? await tx.workspaceMember.findMany({
        where: {
          tenantId: actor.tenantId,
          workspaceId: parsed.data.workspaceId,
          userId: { in: userIds },
          user: { isActive: true, tenantMemberships: { some: { tenantId: actor.tenantId, status: 'ACTIVE' } } },
        },
        select: { userId: true, user: { select: { email: true, fullName: true } } },
      }) : [];
      if (members.length !== userIds.length) return { kind: 'member-invalid' as const };
      const resourceIds = [...new Set(parsed.data.resourceIds)];
      const resources = resourceIds.length ? await tx.$queryRaw<Array<{ id: string; resource_type: 'ROOM' | 'EQUIPMENT'; name: string; email: string; capacity: number | null; location: string | null }>>(Prisma.sql`
        SELECT id, resource_type, name, email, capacity, location
        FROM meeting_resources_v1
        WHERE tenant_id=${actor.tenantId}::uuid AND workspace_id=${parsed.data.workspaceId}::uuid
          AND id=ANY(${resourceIds}::uuid[]) AND is_active=true
      `) : [];
      if (resources.length !== resourceIds.length) return { kind: 'resource-invalid' as const };
      if (resources.filter((item) => item.resource_type === 'ROOM').length > 1) return { kind: 'multiple-rooms' as const };
      const people: ResolvedPerson[] = members.map((item) => ({ userId: item.userId, email: item.user.email, displayName: item.user.fullName }));
      const mappedResources: ResolvedResource[] = resources.map((item) => ({ id: item.id, resourceType: item.resource_type, name: item.name, email: item.email, capacity: item.capacity, location: item.location }));
      return { kind: 'ready' as const, definitionId: definition.id, people, resources: mappedResources };
    });

    if (resolved.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });
    if (resolved.kind === 'definition-missing') return reply.code(409).send({ error: 'meeting_object_definition_missing' });
    if (resolved.kind === 'project-invalid') return reply.code(409).send({ error: 'project_scope_invalid' });
    if (resolved.kind === 'member-invalid') return reply.code(409).send({ error: 'attendee_not_workspace_member' });
    if (resolved.kind === 'resource-invalid') return reply.code(409).send({ error: 'meeting_resource_invalid_or_inactive' });
    if (resolved.kind === 'multiple-rooms') return reply.code(409).send({ error: 'only_one_room_supported_v1' });

    const attendees = dedupeAttendees([
      ...resolved.people.map((person) => ({ userId: person.userId, email: person.email, displayName: person.displayName, attendeeType: 'REQUIRED' as const })),
      ...parsed.data.externalAttendees.map((item) => ({ userId: null, email: item.email, displayName: item.displayName, attendeeType: item.attendeeType })),
    ]);
    const peopleCount = new Set([actor.email.toLowerCase(), ...attendees.map((item) => item.email.toLowerCase())]).size;
    const room = resolved.resources.find((item) => item.resourceType === 'ROOM');
    if (room?.capacity != null && room.capacity < peopleCount) {
      return reply.code(409).send({ error: 'room_capacity_exceeded', room: { id: room.id, name: room.name, capacity: room.capacity }, peopleCount });
    }

    const syncAvailable = config.M365_CALENDAR_SYNC_ENABLED && config.MEETING_CALENDAR_WORKER_AVAILABLE;
    if (parsed.data.requestM365Sync && !syncAvailable) return reply.code(409).send({ error: 'm365_calendar_sync_unavailable' });
    if (parsed.data.requestM365Sync && !config.M365_AVAILABILITY_ENABLED) return reply.code(409).send({ error: 'm365_availability_disabled' });
    const schedules = [...new Set([actor.email.toLowerCase(), ...resolved.people.map((item) => item.email.toLowerCase()), ...resolved.resources.map((item) => item.email.toLowerCase())])];
    if (parsed.data.requestM365Sync && schedules.length > 20) {
      return reply.code(409).send({ error: 'm365_getschedule_entity_limit', message: 'Microsoft Graph getSchedule supports at most 20 users/resources per request in Recurring Meetings V1.', entityCount: schedules.length });
    }
    if (parsed.data.requestM365Sync) {
      try {
        for (const occurrence of occurrences) {
          const results = await graph.getSchedule({ organizerGraphUser: actor.email, schedules, startAt: occurrence.startAt, endAt: occurrence.endAt, intervalMinutes: 30 });
          const byEmail = new Map(results.map((item) => [item.scheduleId.toLowerCase(), item]));
          const conflict = schedules.some((email) => {
            const schedule = byEmail.get(email);
            return !schedule || !scheduleFree(schedule.availabilityView);
          });
          if (conflict) return reply.code(409).send({ error: 'recurring_meeting_slot_conflict', sequence: occurrence.sequence, occurrenceDate: occurrence.occurrenceDate });
        }
      } catch (error) {
        if (error instanceof MicrosoftGraphAvailabilityConfigurationError) return reply.code(409).send({ error: 'm365_availability_disabled' });
        if (error instanceof MicrosoftGraphAvailabilityError) return reply.code(error.retryable ? 503 : 502).send({ error: 'm365_availability_failed' });
        throw error;
      }
    }

    const organizerGraphUser = request.authPrincipal?.provider === 'ENTRA_ID' ? request.authPrincipal.subject : actor.email;
    return withTenant(actor.tenantId, async (tx) => {
      const object = await tx.nexusObject.create({
        data: {
          tenantId: actor.tenantId,
          workspaceId: parsed.data.workspaceId,
          objectDefinitionId: resolved.definitionId,
          objectTypeKey: 'MEETING',
          title: parsed.data.title,
          description: parsed.data.description ?? null,
          status: 'PLANNING',
          priority: 'MEDIUM',
          progress: 0,
          ownerId: actor.userId,
          startDate: occurrences[0]!.startAt,
          dueDate: occurrences[0]!.endAt,
          metadata: { ...(parsed.data.projectId ? { projectId: parsed.data.projectId } : {}), recurringMeetingV1: true },
        },
      });
      const syncStatus = parsed.data.requestM365Sync ? 'PENDING' : 'LOCAL_ONLY';
      const collaborations = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        INSERT INTO meeting_collaboration_v1
          (tenant_id, workspace_id, meeting_object_id, project_id, organizer_user_id, organizer_graph_user,
           start_at, end_at, timezone, location, is_online, online_provider, sync_status)
        VALUES
          (${actor.tenantId}::uuid, ${parsed.data.workspaceId}::uuid, ${object.id}::uuid, ${parsed.data.projectId ?? null}::uuid,
           ${actor.userId}::uuid, ${organizerGraphUser}, ${occurrences[0]!.startAt}, ${occurrences[0]!.endAt}, 'America/Lima',
           ${parsed.data.location ?? room?.location ?? null}, ${parsed.data.isOnline}, 'TEAMS', ${syncStatus}::"MeetingM365SyncStatusV1")
        RETURNING id
      `);
      const collaborationId = collaborations[0]!.id;
      for (const attendee of attendees) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO meeting_collaboration_attendees_v1
            (tenant_id, meeting_collaboration_id, user_id, email, display_name, attendee_type)
          VALUES (${actor.tenantId}::uuid, ${collaborationId}::uuid, ${attendee.userId ?? null}::uuid, ${attendee.email}, ${attendee.displayName}, ${attendee.attendeeType})
        `);
      }
      const daysSql = parsed.data.recurrence.daysOfWeek.length
        ? Prisma.sql`ARRAY[${Prisma.join(parsed.data.recurrence.daysOfWeek)}]::text[]`
        : Prisma.sql`ARRAY[]::text[]`;
      const seriesRows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        INSERT INTO meeting_recurrence_series_v1
          (tenant_id, workspace_id, meeting_collaboration_id, master_meeting_object_id, pattern_type, interval,
           days_of_week, day_of_month, range_type, range_start_date, range_end_date, number_of_occurrences, timezone, created_by)
        VALUES
          (${actor.tenantId}::uuid, ${parsed.data.workspaceId}::uuid, ${collaborationId}::uuid, ${object.id}::uuid,
           ${parsed.data.recurrence.patternType}::"MeetingRecurrencePatternTypeV1", ${parsed.data.recurrence.interval}, ${daysSql},
           ${parsed.data.recurrence.dayOfMonth ?? null}, ${parsed.data.recurrence.rangeType}::"MeetingRecurrenceRangeTypeV1",
           ${occurrences[0]!.occurrenceDate}::date, ${parsed.data.recurrence.endDate ?? null}::date,
           ${parsed.data.recurrence.numberOfOccurrences ?? null}, 'America/Lima', ${actor.userId}::uuid)
        RETURNING id
      `);
      const seriesId = seriesRows[0]!.id;
      for (const occurrence of occurrences) {
        const occurrenceRows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          INSERT INTO meeting_recurrence_occurrences_v1
            (tenant_id, series_id, sequence, occurrence_date, original_start_at, start_at, end_at)
          VALUES (${actor.tenantId}::uuid, ${seriesId}::uuid, ${occurrence.sequence}, ${occurrence.occurrenceDate}::date,
                  ${occurrence.startAt}, ${occurrence.startAt}, ${occurrence.endAt})
          RETURNING id
        `);
        for (const resource of resolved.resources) {
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO meeting_occurrence_resource_bookings_v1
              (tenant_id, occurrence_id, meeting_resource_id, created_by)
            VALUES (${actor.tenantId}::uuid, ${occurrenceRows[0]!.id}::uuid, ${resource.id}::uuid, ${actor.userId}::uuid)
          `);
        }
      }
      if (parsed.data.requestM365Sync) {
        await tx.domainEvent.create({
          data: {
            tenantId: actor.tenantId,
            aggregateId: object.id,
            eventType: 'bridata.meeting.m365.sync.requested',
            payload: { collaborationId, meetingObjectId: object.id, reason: 'recurring_series_created_v1' },
          },
        });
      }
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          userId: actor.userId,
          action: 'RECURRING_MEETING_CREATED_V1',
          resource: 'NEXUS_OBJECT',
          resourceId: object.id,
          correlationId: request.id,
          ipAddress: request.ip,
          details: { seriesId, occurrenceCount: occurrences.length, patternType: parsed.data.recurrence.patternType, rangeType: parsed.data.recurrence.rangeType, resourceIds: resolved.resources.map((item) => item.id), syncRequested: parsed.data.requestM365Sync },
        },
      });
      return reply.code(201).send({ seriesId, masterMeetingObjectId: object.id, collaborationId, occurrenceCount: occurrences.length, version: object.version, syncStatus });
    });
  });

  app.get('/api/v1/meetings-v3/recurring', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() });
    const actor = request.actor!;
    return withTenant(actor.tenantId, async (tx) => {
      if (!(await canAccessWorkspace(tx, actor, parsed.data.workspaceId))) return reply.code(403).send({ error: 'workspace_access_denied' });
      const series = await tx.$queryRaw<Array<{
        id: string; master_meeting_object_id: string; meeting_collaboration_id: string; pattern_type: 'DAILY'|'WEEKLY'|'ABSOLUTE_MONTHLY'; interval: number;
        days_of_week: string[]; day_of_month: number|null; range_type: 'NUMBERED'|'END_DATE'; range_start_date: Date; range_end_date: Date|null; number_of_occurrences: number|null;
        project_id: string|null; lifecycle_status: 'SCHEDULED'|'CANCEL_PENDING'|'CANCELLED'; sync_status: 'LOCAL_ONLY'|'PENDING'|'SYNCED'|'FAILED'; graph_event_id: string|null;
        title: string; description: string|null; version: number;
      }>>(Prisma.sql`
        SELECT s.id, s.master_meeting_object_id, s.meeting_collaboration_id, s.pattern_type, s.interval, s.days_of_week,
               s.day_of_month, s.range_type, s.range_start_date, s.range_end_date, s.number_of_occurrences,
               c.project_id, c.lifecycle_status, c.sync_status, c.graph_event_id, o.title, o.description, o.version
        FROM meeting_recurrence_series_v1 s
        JOIN meeting_collaboration_v1 c ON c.id=s.meeting_collaboration_id AND c.tenant_id=s.tenant_id
        JOIN nexus_objects o ON o.id=s.master_meeting_object_id AND o.tenant_id=s.tenant_id AND o.deleted_at IS NULL
        WHERE s.tenant_id=${actor.tenantId}::uuid AND s.workspace_id=${parsed.data.workspaceId}::uuid
          AND (${parsed.data.projectId ?? null}::uuid IS NULL OR c.project_id=${parsed.data.projectId ?? null}::uuid)
        ORDER BY s.range_start_date, s.id
      `);
      const items = [];
      for (const row of series) {
        const occurrences = await tx.$queryRaw<Array<{
          id:string; sequence:number; occurrence_date:Date; original_start_at:Date; start_at:Date; end_at:Date; version:number;
          lifecycle_status:'SCHEDULED'|'CANCEL_PENDING'|'CANCELLED'; is_exception:boolean; graph_event_id:string|null; cancellation_comment:string|null;
        }>>(Prisma.sql`
          SELECT id, sequence, occurrence_date, original_start_at, start_at, end_at, version, lifecycle_status, is_exception, graph_event_id, cancellation_comment
          FROM meeting_recurrence_occurrences_v1
          WHERE tenant_id=${actor.tenantId}::uuid AND series_id=${row.id}::uuid
          ORDER BY sequence
        `);
        const resources = await tx.$queryRaw<Array<{ id:string; name:string; resource_type:'ROOM'|'EQUIPMENT'; capacity:number|null }>>(Prisma.sql`
          SELECT DISTINCT r.id, r.name, r.resource_type, r.capacity
          FROM meeting_occurrence_resource_bookings_v1 b
          JOIN meeting_recurrence_occurrences_v1 occ ON occ.id=b.occurrence_id AND occ.tenant_id=b.tenant_id
          JOIN meeting_resources_v1 r ON r.id=b.meeting_resource_id AND r.tenant_id=b.tenant_id
          WHERE b.tenant_id=${actor.tenantId}::uuid AND occ.series_id=${row.id}::uuid
          ORDER BY r.resource_type, r.name
        `);
        items.push({
          id: row.id,
          masterMeetingObjectId: row.master_meeting_object_id,
          collaborationId: row.meeting_collaboration_id,
          projectId: row.project_id,
          title: row.title,
          description: row.description,
          version: row.version,
          lifecycleStatus: row.lifecycle_status,
          syncStatus: row.sync_status,
          graphSeriesMasterId: row.graph_event_id,
          recurrence: {
            patternType: row.pattern_type,
            interval: row.interval,
            daysOfWeek: row.days_of_week,
            dayOfMonth: row.day_of_month,
            rangeType: row.range_type,
            startDate: dateOnly(row.range_start_date),
            endDate: row.range_end_date ? dateOnly(row.range_end_date) : null,
            numberOfOccurrences: row.number_of_occurrences,
            timezone: 'America/Lima',
          },
          resources: resources.map((resource) => ({ id: resource.id, name: resource.name, resourceType: resource.resource_type, capacity: resource.capacity })),
          occurrences: occurrences.map((occurrence) => ({
            id: occurrence.id,
            sequence: occurrence.sequence,
            occurrenceDate: dateOnly(occurrence.occurrence_date),
            originalStartAt: occurrence.original_start_at.toISOString(),
            startAt: occurrence.start_at.toISOString(),
            endAt: occurrence.end_at.toISOString(),
            version: occurrence.version,
            lifecycleStatus: occurrence.lifecycle_status,
            isException: occurrence.is_exception,
            graphEventId: occurrence.graph_event_id,
            cancellationComment: occurrence.cancellation_comment,
          })),
        });
      }
      return { items };
    });
  });
}
